import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildGlobe } from "./globe";
import { anchorPosition, arcCurve, buildLayout, orbitPosition, orbitRingPoints, type ConstellationLayout } from "./layout";
import { makeLabel, type LabelHandle } from "./labels";
import type { LinkState } from "../../../types";

export interface SceneNode {
  id: string;
  kind: "satellite" | "ground";
  status: "active" | "disabled";
  bufferRatio: number;
  recent: "forward" | "buffer" | "drop" | null;
}

export interface SceneLink {
  id: string;
  source: string;
  target: string;
  state: LinkState;
}

export interface ScenePacket {
  id: string;
  linkId: string;
  source: string;
  target: string;
  departure: number;
  arrival: number;
}

export interface SceneData {
  seed: number;
  nodes: SceneNode[];
  links: SceneLink[];
  packets: ScenePacket[];
}

export interface SceneOptions {
  labels: boolean;
  links: boolean;
  packets: boolean;
  orbits: boolean;
}

export type SceneSelection = { kind: "node" | "link" | "none"; id: string | null };

export interface SceneCallbacks {
  onSelectNode: (nodeId: string) => void;
  onSelectLink: (linkId: string) => void;
  onSelectNone: () => void;
  onHover?: (target: { kind: "node" | "link"; id: string } | null) => void;
  onError?: (message: string) => void;
}

const LINK_SEGMENTS = 28;

const COLORS = {
  satellite: new THREE.Color("#e9efec"),
  satelliteDown: new THREE.Color("#5d6a6c"),
  ground: new THREE.Color("#d98a63"),
  orbit: new THREE.Color("#2c4249"),
  active: new THREE.Color("#6fd3c6"),
  degraded: new THREE.Color("#d9a13f"),
  down: new THREE.Color("#44545c"),
  packet: new THREE.Color("#f2b48c"),
  selection: new THREE.Color("#ffffff"),
};

export class ConstellationScene {
  private container: HTMLElement;

  private callbacks: SceneCallbacks;

  private renderer: THREE.WebGLRenderer;

  private scene: THREE.Scene;

  private camera: THREE.PerspectiveCamera;

  private controls: OrbitControls;

  private globeDispose: () => void;

  private networkGroup = new THREE.Group();

  private orbitGroup = new THREE.Group();

  private nodeObjects = new Map<string, { mesh: THREE.Mesh; label: LabelHandle; kind: "satellite" | "ground"; baseScale: number }>();

  private linkObjects = new Map<string, { line: THREE.Line; state: LinkState }>();

  private packetObjects = new Map<string, THREE.Mesh>();

  private curves = new Map<string, THREE.QuadraticBezierCurve3>();

  private layout: ConstellationLayout | null = null;

  private data: SceneData = { seed: 42, nodes: [], links: [], packets: [] };

  private options: SceneOptions = { labels: true, links: true, packets: true, orbits: true };

  private selection: SceneSelection = { kind: "none", id: null };

  private hover: { kind: "node" | "link"; id: string } | null = null;

  private raycaster = new THREE.Raycaster();

  private pointer = new THREE.Vector2(-10, -10);

  private pointerActive = false;

  private pointerDownAt: { x: number; y: number } | null = null;

  private resizeObserver: ResizeObserver | null = null;

  private frameHandle = 0;

  private disposed = false;

  private visualTime = 0;

  private targetTime = 0;

  private playing = false;

  private speed = 1;

  private reducedMotion = false;

  private desiredTarget = new THREE.Vector3(0, 0, 0);

  private scratch = new THREE.Vector3();

  private lastFrame = 0;

  private signature = "";

  constructor(container: HTMLElement, callbacks: SceneCallbacks) {
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

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    this.camera.position.set(3.05, 1.95, 4.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.75;
    this.controls.panSpeed = 0.6;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 12;
    this.controls.enablePan = true;
    this.controls.target.set(0, 0, 0);

    const globe = buildGlobe();
    this.globeDispose = globe.dispose;
    this.scene.add(globe.group);
    this.scene.add(this.networkGroup, this.orbitGroup);

    this.scene.add(new THREE.AmbientLight(0xdfe9e6, 0.62));
    const key = new THREE.DirectionalLight(0xfff3e8, 1.45);
    key.position.set(3.4, 2.6, 3.8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x5f8f92, 0.5);
    rim.position.set(-3.6, -1.4, -2.6);
    this.scene.add(rim);

    this.addStarfield();

    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.addEventListener("pointerleave", this.handlePointerLeave);
    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    window.addEventListener("resize", this.handleResize);

    this.lastFrame = performance.now();
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  private addStarfield(): void {
    const count = 520;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const radius = 18 + Math.random() * 18;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.cos(phi);
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: new THREE.Color("#3f5a62"), size: 0.1, sizeAttenuation: true, fog: false });
    const stars = new THREE.Points(geometry, material);
    stars.name = "stars";
    this.scene.add(stars);
  }

  private handleContextLost = (event: Event) => {
    event.preventDefault();
    this.callbacks.onError?.("3D rendering was interrupted by the browser. The node list still works.");
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

  private updatePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerActive = true;
  }

  private handlePointerMove = (event: PointerEvent) => {
    this.updatePointer(event);
  };

  private handlePointerDown = (event: PointerEvent) => {
    this.updatePointer(event);
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
  };

  private handlePointerUp = (event: PointerEvent) => {
    const start = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    this.updatePointer(event);
    this.pick(true);
  };

  private handlePointerLeave = () => {
    this.pointerActive = false;
    this.pointer.set(-10, -10);
    if (this.hover) {
      this.hover = null;
      this.callbacks.onHover?.(null);
    }
  };

  private pick(commit: boolean): void {
    if (!this.pointerActive) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.params.Line = { threshold: 0.035 };

    const nodeMeshes = Array.from(this.nodeObjects.entries());
    const nodeHits = this.raycaster.intersectObjects(nodeMeshes.map(([, entry]) => entry.mesh), false);
    if (nodeHits.length > 0) {
      const hitId = nodeMeshes.find(([, entry]) => entry.mesh === nodeHits[0].object)?.[0] ?? null;
      if (hitId) {
        if (commit) this.callbacks.onSelectNode(hitId);
        this.setHover({ kind: "node", id: hitId });
        return;
      }
    }

    const linkLines = Array.from(this.linkObjects.entries());
    const linkHits = this.raycaster.intersectObjects(linkLines.map(([, entry]) => entry.line), false);
    if (linkHits.length > 0) {
      const hitId = linkLines.find(([, entry]) => entry.line === linkHits[0].object)?.[0] ?? null;
      if (hitId) {
        if (commit) this.callbacks.onSelectLink(hitId);
        this.setHover({ kind: "link", id: hitId });
        return;
      }
    }

    this.setHover(null);
    if (commit) this.callbacks.onSelectNone();
  }

  private setHover(next: { kind: "node" | "link"; id: string } | null): void {
    const same = (!next && !this.hover) || (next && this.hover && next.kind === this.hover.kind && next.id === this.hover.id);
    if (same) return;
    this.hover = next;
    this.renderer.domElement.style.cursor = next ? "pointer" : "grab";
    this.callbacks.onHover?.(next);
  }

  /** Rebuild dynamic objects when the run's node/link set changes. */
  setData(data: SceneData): void {
    const signature = `${data.seed}|${data.nodes.map((node) => node.id).join(",")}|${data.links.map((link) => link.id).join(",")}`;
    const topologyChanged = signature !== this.signature;
    this.data = data;

    if (!topologyChanged) return;
    this.signature = signature;

    const satellites = data.nodes.filter((node) => node.kind === "satellite").map((node) => node.id);
    const grounds = data.nodes.filter((node) => node.kind === "ground").map((node) => node.id);
    const positions = new Map<string, { x: number; y: number }>();
    this.layout = buildLayout(data.seed, satellites, grounds, positions);

    this.clearNetwork();
    this.buildNodes();
    this.buildOrbits();
    this.buildLinks();
    this.applyOptions();
    this.applySelection();
    this.updatePositions(0);
  }

  private clearNetwork(): void {
    for (const [, entry] of this.nodeObjects) {
      this.networkGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
      entry.label.dispose();
      if (entry.label.sprite.parent) entry.label.sprite.parent.remove(entry.label.sprite);
    }
    this.nodeObjects.clear();

    for (const [, entry] of this.linkObjects) {
      this.networkGroup.remove(entry.line);
      entry.line.geometry.dispose();
      (entry.line.material as THREE.Material).dispose();
    }
    this.linkObjects.clear();

    for (const [, mesh] of this.packetObjects) {
      this.networkGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.packetObjects.clear();
    this.curves.clear();

    this.orbitGroup.children.slice().forEach((child) => {
      const line = child as THREE.Line;
      line.geometry?.dispose();
      (line.material as THREE.Material)?.dispose();
      this.orbitGroup.remove(child);
    });
  }

  private buildNodes(): void {
    if (!this.layout) return;
    for (const node of this.data.nodes) {
      const geometry =
        node.kind === "satellite" ? new THREE.OctahedronGeometry(0.042, 0) : new THREE.CylinderGeometry(0.03, 0.042, 0.068, 6);
      const color = node.kind === "satellite" ? COLORS.satellite.clone() : COLORS.ground.clone();
      if (node.status === "disabled") color.lerp(COLORS.satelliteDown, 0.7);
      const material = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.42, metalness: 0.28, emissive: new THREE.Color("#000000") });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `node:${node.id}`;
      mesh.userData.nodeId = node.id;
      const label = makeLabel(node.id, { scale: node.kind === "satellite" ? 0.08 : 0.068 });
      this.scene.add(label.sprite);
      this.networkGroup.add(mesh);
      this.nodeObjects.set(node.id, { mesh, label, kind: node.kind, baseScale: 1 });
    }
  }

  private buildOrbits(): void {
    if (!this.layout) return;
    for (const [, element] of this.layout.satellites) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(orbitRingPoints(element), 3));
      const material = new THREE.LineBasicMaterial({ color: COLORS.orbit, transparent: true, opacity: 0.5, depthWrite: false });
      const line = new THREE.Line(geometry, material);
      line.name = `orbit:${element.nodeId}`;
      this.orbitGroup.add(line);
    }
  }

  private buildLinks(): void {
    const nodes = new Map(this.data.nodes.map((node) => [node.id, node]));
    for (const link of this.data.links) {
      if (!nodes.has(link.source) || !nodes.has(link.target)) continue;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array((LINK_SEGMENTS + 1) * 3);
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const color = link.state === "active" ? COLORS.active : link.state === "degraded" ? COLORS.degraded : COLORS.down;
      const material =
        link.state === "down"
          ? new THREE.LineDashedMaterial({ color, dashSize: 0.03, gapSize: 0.035, transparent: true, opacity: 0.6, depthWrite: false })
          : new THREE.LineBasicMaterial({ color, transparent: true, opacity: link.state === "degraded" ? 0.72 : 0.9, depthWrite: false });
      const line = new THREE.Line(geometry, material);
      line.name = `link:${link.id}`;
      line.userData.linkId = link.id;
      line.computeLineDistances();
      this.networkGroup.add(line);
      this.linkObjects.set(link.id, { line, state: link.state });
    }
  }

  private buildPackets(): void {
    const existing = new Set(this.data.packets.map((packet) => packet.id));
    for (const [id, mesh] of this.packetObjects) {
      if (!existing.has(id)) {
        this.networkGroup.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.packetObjects.delete(id);
      }
    }
    for (const packet of this.data.packets) {
      if (this.packetObjects.has(packet.id)) continue;
      const geometry = new THREE.TetrahedronGeometry(0.03, 0);
      const material = new THREE.MeshStandardMaterial({
        color: COLORS.packet,
        flatShading: true,
        emissive: new THREE.Color("#3a1d0d"),
        roughness: 0.35,
        metalness: 0.2,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `packet:${packet.id}`;
      this.networkGroup.add(mesh);
      this.packetObjects.set(packet.id, mesh);
    }
  }

  private updatePositions(deltaSeconds: number): void {
    if (!this.layout) return;
    const time = this.visualTime;

    for (const node of this.data.nodes) {
      const entry = this.nodeObjects.get(node.id);
      if (!entry) continue;
      if (node.kind === "satellite") {
        const element = this.layout.satellites.get(node.id);
        if (!element) continue;
        orbitPosition(element, time, entry.mesh.position);
      } else {
        const anchor = this.layout.anchors.get(node.id);
        if (!anchor) continue;
        anchorPosition(anchor, entry.mesh.position);
      }
      this.scratch.copy(entry.mesh.position).normalize().multiplyScalar(0.09);
      entry.label.sprite.position.copy(entry.mesh.position).add(this.scratch);
    }

    for (const link of this.data.links) {
      const entry = this.linkObjects.get(link.id);
      if (!entry) continue;
      const from = this.nodeObjects.get(link.source)?.mesh.position;
      const constTo = this.nodeObjects.get(link.target)?.mesh.position;
      if (!from || !constTo) continue;
      const curve = arcCurve(from, constTo, link.state === "down" ? 0.1 : 0.14);
      this.curves.set(link.id, curve);
      const attribute = entry.line.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index <= LINK_SEGMENTS; index += 1) {
        const point = curve.getPoint(index / LINK_SEGMENTS);
        attribute.setXYZ(index, point.x, point.y, point.z);
      }
      attribute.needsUpdate = true;
      entry.line.geometry.computeBoundingSphere();
      if (link.state === "down") entry.line.computeLineDistances();
    }

    for (const packet of this.data.packets) {
      const mesh = this.packetObjects.get(packet.id);
      if (!mesh) continue;
      const curve = this.curves.get(packet.linkId);
      if (!curve) {
        mesh.visible = false;
        continue;
      }
      const span = Math.max(0.001, packet.arrival - packet.departure);
      const t = THREE.MathUtils.clamp((time - packet.departure) / span, 0, 1);
      mesh.visible = true;
      curve.getPoint(t, mesh.position);
      mesh.rotation.x += deltaSeconds * 1.4;
      mesh.rotation.y += deltaSeconds * 1.1;
    }
  }

  setTime(simTime: number, playing: boolean, speed: number): void {
    this.targetTime = simTime;
    this.playing = playing;
    this.speed = speed;
    if (!this.playing || this.reducedMotion) {
      this.visualTime = simTime;
    } else if (Math.abs(this.visualTime - simTime) > 2.5) {
      this.visualTime = simTime;
    }
  }

  setOptions(options: Partial<SceneOptions>): void {
    this.options = { ...this.options, ...options };
    this.applyOptions();
  }

  private applyOptions(): void {
    for (const [, entry] of this.nodeObjects) {
      entry.label.sprite.visible = this.options.labels;
    }
    for (const [, entry] of this.linkObjects) {
      entry.line.visible = this.options.links;
    }
    this.orbitGroup.visible = this.options.orbits;
    for (const [, mesh] of this.packetObjects) {
      mesh.visible = this.options.packets;
    }
  }

  setSelection(selection: SceneSelection): void {
    this.selection = selection;
    this.applySelection();
    if (selection.kind === "node" && selection.id) {
      const entry = this.nodeObjects.get(selection.id);
      if (entry) this.desiredTarget.copy(entry.mesh.position);
    }
  }

  private applySelection(): void {
    for (const [id, entry] of this.nodeObjects) {
      const material = entry.mesh.material as THREE.MeshStandardMaterial;
      const selected = this.selection.kind === "node" && this.selection.id === id;
      material.emissive.setStyle(selected ? "#4a2a17" : "#000000");
      const scale = selected ? entry.baseScale * 1.75 : entry.baseScale;
      entry.mesh.scale.setScalar(scale);
      entry.label.sprite.material.opacity = selected ? 1 : 0.86;
    }
    for (const [id, entry] of this.linkObjects) {
      const material = entry.line.material as THREE.LineBasicMaterial;
      const selected = this.selection.kind === "link" && this.selection.id === id;
      material.opacity = selected ? 1 : entry.state === "down" ? 0.6 : entry.state === "degraded" ? 0.72 : 0.9;
      if (material.color) {
        const base = entry.state === "active" ? COLORS.active : entry.state === "degraded" ? COLORS.degraded : COLORS.down;
        material.color.copy(selected ? COLORS.selection : base);
      }
    }
  }

  resetView(): void {
    this.camera.position.set(3.05, 1.95, 4.2);
    this.desiredTarget.set(0, 0, 0);
    this.controls.target.set(0, 0, 0);
  }

  zoomBy(factor: number): void {
    this.scratch.copy(this.camera.position).sub(this.controls.target);
    const length = THREE.MathUtils.clamp(this.scratch.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.scratch.setLength(length);
    this.camera.position.copy(this.controls.target).add(this.scratch);
  }

  private tick = () => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.tick);
    const now = performance.now();
    const delta = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.reducedMotion) {
      this.visualTime = this.targetTime;
    } else if (this.playing) {
      this.visualTime += delta * this.speed;
      if (this.visualTime > this.targetTime + 0.4) this.visualTime = this.targetTime;
    } else {
      this.visualTime += (this.targetTime - this.visualTime) * Math.min(1, delta * 7);
      if (Math.abs(this.targetTime - this.visualTime) < 0.002) this.visualTime = this.targetTime;
    }

    this.updatePositions(delta);
    this.buildPackets();

    if (this.pointerActive && !this.pointerDownAt) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      this.raycaster.params.Line = { threshold: 0.03 };
      const nodeMeshes = Array.from(this.nodeObjects.values()).map((entry) => entry.mesh);
      const hits = this.raycaster.intersectObjects(nodeMeshes, false);
      if (hits.length > 0) {
        const id = nodeMeshes.find((mesh) => mesh === hits[0].object)?.userData.nodeId;
        this.setHover(id ? { kind: "node", id: String(id) } : null);
      } else if (this.hover?.kind === "node") {
        this.setHover(null);
      }
    }

    this.controls.target.lerp(this.desiredTarget, 0.08);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener("resize", this.handleResize);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.removeEventListener("pointerleave", this.handlePointerLeave);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);
    this.resizeObserver?.disconnect();
    this.clearNetwork();
    this.globeDispose();
    this.scene.traverse((child) => {
      const asMesh = child as THREE.Mesh;
      asMesh.geometry?.dispose?.();
      const material = asMesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.scene.clear();
  }

  /** Exposed for tests/debug: current schematic time. */
  get currentVisualTime(): number {
    return this.visualTime;
  }
}