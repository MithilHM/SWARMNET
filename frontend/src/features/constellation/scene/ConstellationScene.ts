import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildGlobe, GLOBE_RADIUS } from "./globe";
import { latLonToVector } from "./geo";
import { makeLabel, type LabelHandle } from "./labels";
import type { Anomaly, DtnState, InFlightPacket, Phase, SessionLink, SessionNode, SimEvent } from "../../../types";

/** Everything the scene draws. All of it comes from the backend session. */
export interface SceneInput {
  nodes: SessionNode[];
  links: SessionLink[];
  inFlight: InFlightPacket[];
  simTime: number;
  receivedAt: number;
  halted: boolean;
  timeScale: number;
  tickSeconds: number;
  anomaly: Anomaly | null;
  dtn: DtnState | null;
  scenarioId: string;
  phase: Phase;
}

export interface SceneCallbacks {
  onError?: (message: string) => void;
}

const LINK_SEGMENTS = 32;

const COLORS = {
  satellite: new THREE.Color("#e9efec"),
  ground: new THREE.Color("#d98a63"),
  active: new THREE.Color("#6fd3c6"),
  degraded: new THREE.Color("#d9a13f"),
  down: new THREE.Color("#4a5a62"),
  anomaly: new THREE.Color("#ff4b3e"),
  dtn: new THREE.Color("#7be08f"),
  packet: new THREE.Color("#f2b48c"),
  bundle: new THREE.Color("#7be08f"),
  lost: new THREE.Color("#ff4b3e"),
};

type LinkStyle = "active" | "degraded" | "down" | "anomaly" | "dtn";

interface LinkEntry {
  line: THREE.Line;
  tube: THREE.Mesh | null;
  style: LinkStyle | null;
  curve: THREE.QuadraticBezierCurve3 | null;
}

interface NodeEntry {
  mesh: THREE.Mesh;
  label: LabelHandle;
  kind: "satellite" | "ground";
}

interface Burst {
  mesh: THREE.Mesh;
  born: number;
}

const BURST_MS = 900;

function nodeVector(node: SessionNode, target: THREE.Vector3): THREE.Vector3 {
  const radius = node.kind === "ground" ? GLOBE_RADIUS * 1.012 : GLOBE_RADIUS * (1.2 + ((node.alt_km - 520) / 80) * 0.03);
  const out = { x: 0, y: 0, z: 0 };
  latLonToVector(node.lat, node.lon, radius, out);
  return target.set(out.x, out.y, out.z);
}

function linkStyle(link: SessionLink): LinkStyle {
  if (link.role === "anomaly") return "anomaly";
  if (link.role === "dtn") return "dtn";
  return link.state;
}

function curveBetween(from: THREE.Vector3, to: THREE.Vector3, kind: "ground" | "isl"): THREE.QuadraticBezierCurve3 {
  const mid = from.clone().add(to).multiplyScalar(0.5);
  if (kind === "isl") {
    const length = Math.max(from.length(), to.length());
    mid.normalize().multiplyScalar(length * 1.04);
  } else {
    mid.normalize().multiplyScalar(mid.length() * 1.03 + 0.02);
  }
  return new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
}

export class ConstellationScene {
  private container: HTMLElement;
  private callbacks: SceneCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private globeDispose: () => void;
  private networkGroup = new THREE.Group();
  private nodes = new Map<string, NodeEntry>();
  private links = new Map<string, LinkEntry>();
  private packets = new Map<string, THREE.Mesh>();
  private bursts: Burst[] = [];
  private input: SceneInput | null = null;
  private signature = "";
  private labelsVisible = true;
  private frameHandle = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private anomalyBox: HTMLDivElement;
  private relayBox: HTMLDivElement;
  private scratch = new THREE.Vector3();
  private projected = new THREE.Vector3();
  private homeDirection = new THREE.Vector3(0.6, 0.45, 0.66).normalize();
  private homeDistance = 2.75;
  private homeTarget = new THREE.Vector3(0, 0, 0);

  constructor(container: HTMLElement, callbacks: SceneCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(new THREE.Color("#0c1316"), 1);
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(new THREE.Color("#0c1316"), 9, 22);
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    this.camera.position.copy(this.homeDirection).multiplyScalar(this.homeDistance);

    this.controls = this.makeControls();

    const globe = buildGlobe();
    this.globeDispose = globe.dispose;
    this.scene.add(globe.group, this.networkGroup);
    this.scene.add(new THREE.AmbientLight(0xdfe9e6, 0.62));
    const key = new THREE.DirectionalLight(0xfff3e8, 1.45);
    key.position.set(3.4, 2.6, 3.8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x5f8f92, 0.5);
    rim.position.set(-3.6, -1.4, -2.6);
    this.scene.add(rim);
    this.addStarfield();

    this.anomalyBox = this.makeBox("stage-box stage-box-anomaly");
    this.relayBox = this.makeBox("stage-box stage-box-relay");

    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    window.addEventListener("resize", this.handleResize);
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  private makeControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.62;
    controls.zoomSpeed = 0.75;
    controls.minDistance = 0.8;
    controls.maxDistance = 9;
    controls.enablePan = false;
    return controls;
  }

  private makeBox(className: string): HTMLDivElement {
    const box = document.createElement("div");
    box.className = className;
    box.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "stage-box-label";
    box.appendChild(label);
    box.style.display = "none";
    this.container.appendChild(box);
    return box;
  }

  private addStarfield(): void {
    const count = 520;
    const positions = new Float32Array(count * 3);
    // Deterministic starfield so the backdrop never changes between runs.
    let state = 1234567;
    const random = () => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647;
    };
    for (let index = 0; index < count; index += 1) {
      const radius = 18 + random() * 18;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.cos(phi);
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: new THREE.Color("#3f5a62"), size: 0.1, sizeAttenuation: true, fog: false });
    this.scene.add(new THREE.Points(geometry, material));
  }

  private handleContextLost = (event: Event) => {
    event.preventDefault();
    this.callbacks.onError?.("3D rendering was interrupted by the browser. The tabs still show the full run.");
  };

  private handleResize = () => this.resize();

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setInput(input: SceneInput): void {
    const signature = `${input.scenarioId}|${input.nodes.map((n) => n.id).join(",")}|${input.links.map((l) => l.link_id).join(",")}`;
    this.input = input;
    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild();
    }
    this.syncLinkStyles();
    this.syncNodeRoles();
    this.syncPackets();
  }

  /** Visualise loss events reported by the backend. */
  pushEvents(events: SimEvent[]): void {
    for (const event of events) {
      if (event.type !== "packet" || event.status !== "lost" || !event.link_id) continue;
      const entry = this.links.get(event.link_id);
      if (!entry?.curve) continue;
      const geometry = new THREE.SphereGeometry(0.022, 12, 10);
      const material = new THREE.MeshBasicMaterial({ color: COLORS.lost, transparent: true, opacity: 1, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      const towardTarget = this.links.get(event.link_id)?.line.userData.source === event.node_id;
      entry.curve.getPoint(towardTarget ? 0.82 : 0.18, mesh.position);
      this.networkGroup.add(mesh);
      this.bursts.push({ mesh, born: performance.now() });
    }
  }

  setLabels(visible: boolean): void {
    this.labelsVisible = visible;
    for (const entry of this.nodes.values()) entry.label.sprite.visible = visible;
  }

  resetView(): void {
    this.controls.target.copy(this.homeTarget);
    this.camera.position.copy(this.homeTarget).addScaledVector(this.homeDirection, this.homeDistance);
  }

  zoomBy(factor: number): void {
    this.scratch.copy(this.camera.position).sub(this.controls.target);
    const length = THREE.MathUtils.clamp(this.scratch.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.scratch.setLength(length);
    this.camera.position.copy(this.controls.target).add(this.scratch);
  }

  private rebuild(): void {
    this.clearNetwork();
    const input = this.input;
    if (!input) return;

    for (const node of input.nodes) {
      const geometry =
        node.kind === "satellite" ? new THREE.OctahedronGeometry(0.04, 0) : new THREE.CylinderGeometry(0.03, 0.042, 0.068, 6);
      const material = new THREE.MeshStandardMaterial({
        color: (node.kind === "satellite" ? COLORS.satellite : COLORS.ground).clone(),
        flatShading: true,
        roughness: 0.42,
        metalness: 0.28,
        emissive: new THREE.Color("#000000"),
      });
      const mesh = new THREE.Mesh(geometry, material);
      nodeVector(node, mesh.position);
      if (node.kind === "ground") {
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), mesh.position.clone().normalize());
      }
      const label = makeLabel(node.id, { scale: node.kind === "satellite" ? 0.04 : 0.034 });
      label.sprite.visible = this.labelsVisible;
      this.scene.add(label.sprite);
      this.networkGroup.add(mesh);
      this.nodes.set(node.id, { mesh, label, kind: node.kind });
    }

    for (const link of input.links) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((LINK_SEGMENTS + 1) * 3), 3));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial());
      line.userData.source = link.source_node_id;
      line.userData.kind = link.kind;
      this.networkGroup.add(line);
      this.links.set(link.link_id, { line, tube: null, style: null, curve: null });
    }

    // Orbit the camera around the constellation, looking across the satellite chain with the
    // local vertical as "up", so satellites sit visibly above their ground stations.
    const centroid = new THREE.Vector3();
    for (const entry of this.nodes.values()) centroid.add(entry.mesh.position);
    if (this.nodes.size > 0 && centroid.lengthSq() > 0) {
      centroid.divideScalar(this.nodes.size);
      const radial = centroid.clone().normalize();
      let extent = 0;
      for (const entry of this.nodes.values()) extent = Math.max(extent, entry.mesh.position.distanceTo(centroid));
      const sats = input.nodes.filter((node) => node.kind === "satellite").map((node) => this.nodes.get(node.id)!.mesh.position);
      const axis = sats.length > 1 ? sats[sats.length - 1].clone().sub(sats[0]) : new THREE.Vector3(0, 1, 0);
      axis.addScaledVector(radial, -axis.dot(radial));
      if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0).addScaledVector(radial, -radial.y);
      const across = new THREE.Vector3().crossVectors(radial, axis.normalize()).normalize();
      this.homeTarget.copy(centroid);
      this.homeDirection.copy(radial).multiplyScalar(0.78).addScaledVector(across, 0.62).normalize();
      this.homeDistance = THREE.MathUtils.clamp(extent * 5.2, 1.8, 6);
      this.camera.up.copy(radial);
      this.controls.dispose();
      this.controls = this.makeControls();
      this.resetView();
    }
  }

  private clearNetwork(): void {
    for (const entry of this.nodes.values()) {
      this.networkGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
      this.scene.remove(entry.label.sprite);
      entry.label.dispose();
    }
    this.nodes.clear();
    for (const entry of this.links.values()) this.disposeLink(entry);
    this.links.clear();
    for (const mesh of this.packets.values()) this.disposeMesh(mesh);
    this.packets.clear();
    for (const burst of this.bursts) this.disposeMesh(burst.mesh);
    this.bursts = [];
  }

  private disposeMesh(mesh: THREE.Mesh): void {
    this.networkGroup.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  private disposeLink(entry: LinkEntry): void {
    this.networkGroup.remove(entry.line);
    entry.line.geometry.dispose();
    (entry.line.material as THREE.Material).dispose();
    if (entry.tube) this.disposeMesh(entry.tube);
  }

  private syncLinkStyles(): void {
    if (!this.input) return;
    for (const link of this.input.links) {
      const entry = this.links.get(link.link_id);
      if (!entry) continue;
      const style = linkStyle(link);
      if (style === entry.style) continue;
      entry.style = style;
      (entry.line.material as THREE.Material).dispose();
      const color =
        style === "anomaly" ? COLORS.anomaly : style === "dtn" ? COLORS.dtn : style === "active" ? COLORS.active : style === "degraded" ? COLORS.degraded : COLORS.down;
      const dashed = style === "anomaly" || style === "down" || style === "degraded";
      entry.line.material = dashed
        ? new THREE.LineDashedMaterial({
            color,
            dashSize: style === "anomaly" ? 0.035 : 0.025,
            gapSize: style === "anomaly" ? 0.03 : 0.03,
            transparent: true,
            opacity: style === "down" ? 0.6 : 1,
            depthWrite: false,
          })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity: style === "dtn" ? 1 : 0.88, depthWrite: false });
      if (entry.tube) {
        this.disposeMesh(entry.tube);
        entry.tube = null;
      }
      entry.curve = null; // force geometry refresh (tube follows the curve)
    }
  }

  private syncNodeRoles(): void {
    if (!this.input) return;
    for (const node of this.input.nodes) {
      const entry = this.nodes.get(node.id);
      if (!entry) continue;
      nodeVector(node, entry.mesh.position);
      const material = entry.mesh.material as THREE.MeshStandardMaterial;
      const base = node.kind === "satellite" ? COLORS.satellite : COLORS.ground;
      material.color.copy(node.role === "affected" ? COLORS.anomaly : node.role === "relay" ? COLORS.dtn : base);
      entry.mesh.userData.role = node.role;
    }
  }

  private syncPackets(): void {
    if (!this.input) return;
    const live = new Set(this.input.inFlight.map((packet) => packet.packet_id));
    for (const [id, mesh] of this.packets) {
      if (!live.has(id)) {
        this.disposeMesh(mesh);
        this.packets.delete(id);
      }
    }
    for (const packet of this.input.inFlight) {
      if (this.packets.has(packet.packet_id)) continue;
      const dtn = packet.mode === "dtn";
      const geometry = dtn ? new THREE.OctahedronGeometry(0.026, 0) : new THREE.TetrahedronGeometry(0.026, 0);
      const material = new THREE.MeshStandardMaterial({
        color: dtn ? COLORS.bundle : COLORS.packet,
        flatShading: true,
        emissive: dtn ? new THREE.Color("#1d5a2a") : new THREE.Color("#3a1d0d"),
        roughness: 0.35,
        metalness: 0.2,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.networkGroup.add(mesh);
      this.packets.set(packet.packet_id, mesh);
    }
  }

  /** Simulated time to draw: last backend time, extrapolated by at most one tick while running. */
  private visualTime(now: number): number {
    const input = this.input;
    if (!input) return 0;
    if (input.halted) return input.simTime;
    const ahead = ((now - input.receivedAt) / 1000) * input.timeScale;
    return input.simTime + Math.min(Math.max(0, ahead), input.tickSeconds);
  }

  private updateGeometry(now: number): void {
    const input = this.input;
    if (!input) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);

    for (const entry of this.nodes.values()) {
      this.scratch.copy(entry.mesh.position).normalize().multiplyScalar(entry.kind === "satellite" ? 0.07 : -0.05);
      entry.label.sprite.position.copy(entry.mesh.position).add(this.scratch);
      const role = entry.mesh.userData.role as SessionNode["role"];
      const material = entry.mesh.material as THREE.MeshStandardMaterial;
      if (role === "affected") {
        material.emissive.setRGB(0.55 * pulse, 0.05, 0.03);
        entry.mesh.scale.setScalar(1.35 + 0.2 * pulse);
      } else if (role === "relay") {
        material.emissive.setRGB(0.05, 0.35, 0.1);
        entry.mesh.scale.setScalar(1.45);
      } else {
        material.emissive.setRGB(0, 0, 0);
        entry.mesh.scale.setScalar(1);
      }
      entry.mesh.rotation.y += entry.kind === "satellite" ? 0.004 : 0;
    }

    for (const link of input.links) {
      const entry = this.links.get(link.link_id);
      const from = this.nodes.get(link.source_node_id)?.mesh.position;
      const to = this.nodes.get(link.target_node_id)?.mesh.position;
      if (!entry || !from || !to) continue;
      const curve = curveBetween(from, to, link.kind);
      const moved = !entry.curve || !entry.curve.v0.equals(curve.v0) || !entry.curve.v2.equals(curve.v2);
      entry.curve = curve;
      if (moved) {
        const attribute = entry.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let index = 0; index <= LINK_SEGMENTS; index += 1) {
          const point = curve.getPoint(index / LINK_SEGMENTS);
          attribute.setXYZ(index, point.x, point.y, point.z);
        }
        attribute.needsUpdate = true;
        entry.line.geometry.computeBoundingSphere();
        entry.line.computeLineDistances();
        if (entry.style === "dtn") {
          if (entry.tube) this.disposeMesh(entry.tube);
          const tube = new THREE.Mesh(
            new THREE.TubeGeometry(curve, LINK_SEGMENTS, 0.007, 6, false),
            new THREE.MeshBasicMaterial({ color: COLORS.dtn, transparent: true, opacity: 0.55, depthWrite: false }),
          );
          this.networkGroup.add(tube);
          entry.tube = tube;
        }
      }
      if (entry.style === "anomaly") {
        (entry.line.material as THREE.LineDashedMaterial).opacity = 0.45 + 0.55 * pulse;
      }
    }

    const time = this.visualTime(now);
    for (const packet of input.inFlight) {
      const mesh = this.packets.get(packet.packet_id);
      const entry = this.links.get(packet.link_id);
      if (!mesh || !entry?.curve) continue;
      const span = Math.max(1e-6, packet.arrive - packet.depart);
      const progress = THREE.MathUtils.clamp((time - packet.depart) / span, 0, 1);
      const forward = entry.line.userData.source === packet.source;
      entry.curve.getPoint(forward ? progress : 1 - progress, mesh.position);
      mesh.visible = true;
      mesh.rotation.x += 0.03;
      mesh.rotation.y += 0.025;
    }

    this.bursts = this.bursts.filter((burst) => {
      const age = now - burst.born;
      if (age > BURST_MS) {
        this.disposeMesh(burst.mesh);
        return false;
      }
      const k = age / BURST_MS;
      burst.mesh.scale.setScalar(1 + k * 2.6);
      (burst.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      return true;
    });
  }

  private placeBox(box: HTMLDivElement, nodeIds: string[], text: string, active = true): void {
    box.dataset.active = active ? "true" : "false";
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of nodeIds) {
      const entry = this.nodes.get(id);
      if (!entry) continue;
      this.projected.copy(entry.mesh.position).project(this.camera);
      const x = (this.projected.x * 0.5 + 0.5) * width;
      const y = (-this.projected.y * 0.5 + 0.5) * height;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (!Number.isFinite(minX)) {
      box.style.display = "none";
      return;
    }
    const pad = 26;
    box.style.display = "block";
    box.style.left = `${Math.round(minX - pad)}px`;
    box.style.top = `${Math.round(minY - pad)}px`;
    box.style.width = `${Math.round(maxX - minX + pad * 2)}px`;
    box.style.height = `${Math.round(maxY - minY + pad * 2)}px`;
    const label = box.firstElementChild as HTMLElement;
    if (label.textContent !== text) label.textContent = text;
  }

  private updateBoxes(): void {
    const input = this.input;
    if (input?.anomaly) {
      this.placeBox(
        this.anomalyBox,
        [input.anomaly.satellite_id, input.anomaly.ground_station_id],
        `${input.anomaly.satellite_id} → ${input.anomaly.ground_station_id} · ${Math.round(input.anomaly.loss_rate * 100)}% loss`,
        input.phase === "DETECTED",
      );
    } else {
      this.anomalyBox.style.display = "none";
    }
    if (input?.dtn?.relay_id) {
      this.placeBox(this.relayBox, [input.dtn.relay_id], `Relay ${input.dtn.relay_id}`);
    } else {
      this.relayBox.style.display = "none";
    }
  }

  private tick = () => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.tick);
    const now = performance.now();
    this.updateGeometry(now);
    this.controls.update();
    this.updateBoxes();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener("resize", this.handleResize);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);
    this.resizeObserver?.disconnect();
    this.clearNetwork();
    this.globeDispose();
    this.anomalyBox.remove();
    this.relayBox.remove();
    this.scene.traverse((child) => {
      const asMesh = child as THREE.Mesh;
      asMesh.geometry?.dispose?.();
      const material = asMesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) this.container.removeChild(this.renderer.domElement);
    this.scene.clear();
  }
}
