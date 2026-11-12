import * as THREE from "three";
import { isLand, latLonToVector } from "./geo";

export const GLOBE_RADIUS = 1;

const OCEAN = new THREE.Color("#12242c");
const LAND = new THREE.Color("#3c565e");
const COAST = new THREE.Color("#4a6a72");

export interface GlobeBuild {
  group: THREE.Group;
  dispose: () => void;
}

/** Faceted icosphere whose faces are classified as land or ocean. */
function buildFacetedEarth(): { mesh: THREE.Mesh; relief: Float32Array } {
  const geometry = new THREE.IcosahedronGeometry(GLOBE_RADIUS, 5);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const faceCount = position.count / 3;
  const colors = new Float32Array(position.count * 3);
  const scratch = { x: 0, y: 0, z: 0 };
  const centroid = new THREE.Vector3();

  for (let face = 0; face < faceCount; face += 1) {
    centroid.set(0, 0, 0);
    for (let corner = 0; corner < 3; corner += 1) {
      const index = face * 3 + corner;
      centroid.x += position.getX(index);
      centroid.y += position.getY(index);
      centroid.z += position.getZ(index);
    }
    centroid.divideScalar(3).normalize();

    latLonToVector(0, 0, 1, scratch);
    const lat = (Math.asin(THREE.MathUtils.clamp(centroid.y, -1, 1)) * 180) / Math.PI;
    const lon = (Math.atan2(-centroid.z, centroid.x) * 180) / Math.PI;
    const land = isLand(lon, lat);
    const color = land ? LAND : OCEAN;

    for (let corner = 0; corner < 3; corner += 1) {
      const index = face * 3 + corner;
      const shade = land ? 1 : 0.92 + ((face % 7) / 7) * 0.12;
      colors[index * 3] = color.r * shade;
      colors[index * 3 + 1] = color.g * shade;
      colors[index * 3 + 2] = color.b * shade;
    }
  }

  // Nudge land faces outward so continents read as raised plates.
  const relief = new Float32Array(position.count);
  for (let face = 0; face < faceCount; face += 1) {
    centroid.set(0, 0, 0);
    for (let corner = 0; corner < 3; corner += 1) {
      const index = face * 3 + corner;
      centroid.x += position.getX(index);
      centroid.y += position.getY(index);
      centroid.z += position.getZ(index);
    }
    centroid.divideScalar(3).normalize();
    const lat = (Math.asin(THREE.MathUtils.clamp(centroid.y, -1, 1)) * 180) / Math.PI;
    const lon = (Math.atan2(-centroid.z, centroid.x) * 180) / Math.PI;
    const lift = isLand(lon, lat) ? 1.006 : 1;
    for (let corner = 0; corner < 3; corner += 1) {
      const index = face * 3 + corner;
      position.setXYZ(index, position.getX(index) * lift, position.getY(index) * lift, position.getZ(index) * lift);
      relief[index] = lift;
    }
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.94,
    metalness: 0.02,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "earth";
  return { mesh, relief };
}

function buildGraticule(radius: number): THREE.LineSegments {
  const points: number[] = [];
  const step = 15;
  const r = radius * 1.0015;
  const scratch = { x: 0, y: 0, z: 0 };

  for (let lon = -180; lon < 180; lon += step * 2) {
    for (let lat = -80; lat < 80; lat += 2) {
      latLonToVector(lat, lon, r, scratch);
      points.push(scratch.x, scratch.y, scratch.z);
      latLonToVector(lat + 2, lon, r, scratch);
      points.push(scratch.x, scratch.y, scratch.z);
    }
  }
  for (let lat = -75; lat <= 75; lat += step) {
    for (let lon = -180; lon < 180; lon += 2) {
      latLonToVector(lat, lon, r, scratch);
      points.push(scratch.x, scratch.y, scratch.z);
      latLonToVector(lat, lon + 2, r, scratch);
      points.push(scratch.x, scratch.y, scratch.z);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(COAST),
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });
  return new THREE.LineSegments(geometry, material);
}

/** Faint facet edges: gives the globe its cut-stone silhouette. */
function buildFacetEdges(radius: number): THREE.LineSegments {
  const geometry = new THREE.IcosahedronGeometry(radius * 1.0025, 3);
  const edges = new THREE.WireframeGeometry(geometry);
  geometry.dispose();
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color("#0d1a1f"),
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  return new THREE.LineSegments(edges, material);
}

export function buildGlobe(): GlobeBuild {
  const group = new THREE.Group();
  group.name = "globe";

  const { mesh: earth } = buildFacetedEarth();
  const graticule = buildGraticule(GLOBE_RADIUS);
  const edges = buildFacetEdges(GLOBE_RADIUS);
  group.add(earth, graticule, edges);

  const dispose = () => {
    group.traverse((child) => {
      const asMesh = child as THREE.Mesh;
      if (asMesh.geometry) asMesh.geometry.dispose();
      const material = asMesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    group.clear();
  };

  return { group, dispose };
}