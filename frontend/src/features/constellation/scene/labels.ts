import * as THREE from "three";

export interface LabelHandle {
  sprite: THREE.Sprite;
  dispose: () => void;
}

/** Crisp screen-facing label drawn to a canvas texture. */
export function makeLabel(
  text: string,
  options: { color?: string; background?: string; scale?: number; weight?: number } = {},
): LabelHandle {
  const { color = "#e8eeeb", background = "rgba(8, 14, 17, 0.72)", scale = 0.055, weight = 500 } = options;
  const fontSize = 44;
  const padding = 14;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const font = `${weight} ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
  if (context) context.font = font;
  const width = Math.ceil((context ? context.measureText(text).width : text.length * fontSize * 0.6) + padding * 2);
  const height = fontSize + padding * 2;
  canvas.width = width;
  canvas.height = height;

  if (context) {
    context.font = font;
    context.fillStyle = background;
    const radius = 8;
    context.beginPath();
    context.moveTo(radius, 0);
    context.lineTo(width - radius, 0);
    context.quadraticCurveTo(width, 0, width, radius);
    context.lineTo(width, height - radius);
    context.quadraticCurveTo(width, height, width - radius, height);
    context.lineTo(radius, height);
    context.quadraticCurveTo(0, height, 0, height - radius);
    context.lineTo(0, radius);
    context.quadraticCurveTo(0, 0, radius, 0);
    context.fill();
    context.fillStyle = color;
    context.textBaseline = "middle";
    context.fillText(text, padding, height / 2 + 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const aspect = width / height;
  sprite.scale.set(scale * aspect, scale, 1);

  return {
    sprite,
    dispose: () => {
      texture.dispose();
      material.dispose();
    },
  };
}