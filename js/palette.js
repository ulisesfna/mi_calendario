// Paletas de color. La cuadrícula principal ofrece 24 tonos × 4 intensidades
// y las paletas con nombre se usan para importar horarios o recolorear grupos.

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

const TONES = [
  { name: 'Pastel', s: 70, l: 80 },
  { name: 'Suave', s: 62, l: 66 },
  { name: 'Vivo', s: 72, l: 50 },
  { name: 'Profundo', s: 65, l: 34 },
];

/** Filas de la cuadrícula de colores (cada fila es una intensidad) */
export const GRID = TONES.map((t) => ({
  name: t.name,
  colors: Array.from({ length: 24 }, (_, i) => hslToHex(i * 15, t.s, t.l)),
}));

export const NEUTRALS = ['#1f2937', '#4b5563', '#6b7280', '#9ca3af', '#d1d5db', '#a8a29e', '#78716c', '#57534e'];

export const NAMED_PALETTES = {
  'Google clásico': ['#d50000', '#e67c73', '#f4511e', '#f6bf26', '#33b679', '#0b8043', '#039be5', '#3f51b5', '#7986cb', '#8e24aa', '#616161'],
  Vivo: ['#e6194b', '#3cb44b', '#ffb000', '#4363d8', '#f58231', '#911eb4', '#2ab7ca', '#f032e6', '#9bc53d', '#e75480', '#008080', '#9a6324'],
  Pastel: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#f1c0e8', '#b9fbc0', '#cfbaf0', '#fbf8cc'],
  Océano: ['#03045e', '#023e8a', '#0077b6', '#0096c7', '#00b4d8', '#48cae4', '#2a9d8f', '#264653', '#4cc9f0', '#3a86ff', '#90e0ef', '#1d3557'],
  Bosque: ['#2d6a4f', '#40916c', '#52b788', '#74c69d', '#1b4332', '#606c38', '#283618', '#a7c957', '#6a994e', '#386641', '#95d5b2', '#588157'],
  Atardecer: ['#f94144', '#f3722c', '#f8961e', '#f9844a', '#f9c74f', '#e76f51', '#d62828', '#ff006e', '#fb5607', '#ffbe0b', '#e85d04', '#9d0208'],
  Neón: ['#ff00a8', '#00f5d4', '#fee440', '#9b5de5', '#00bbf9', '#f15bb5', '#39ff14', '#ff6700', '#7df9ff', '#ff3131', '#bc13fe', '#ccff00'],
  Tierra: ['#8d6e63', '#a1887f', '#bc6c25', '#dda15e', '#606c38', '#283618', '#b08968', '#7f5539', '#9c6644', '#ddb892', '#6f4e37', '#a98467'],
  Uva: ['#3c096c', '#5a189a', '#7b2cbf', '#9d4edd', '#c77dff', '#e0aaff', '#480ca8', '#7209b7', '#b5179e', '#f72585', '#560bad', '#3a0ca3'],
  Arcoíris: Array.from({ length: 12 }, (_, i) => hslToHex(i * 30, 75, 52)),
};

export const ALL_COLORS = [...GRID.flatMap((r) => r.colors), ...NEUTRALS];

/** Devuelve el primer color de la paleta que todavía no se usa */
export function nextFreeColor(used, palette = NAMED_PALETTES.Vivo) {
  const set = new Set(used.map((c) => c.toLowerCase()));
  return palette.find((c) => !set.has(c.toLowerCase())) ?? palette[used.length % palette.length];
}

export const EMOJIS = ['📚', '🧪', '🧮', '💻', '🏃', '🍽️', '💼', '🎉', '🎵', '🏠', '❤️', '🩺', '✈️', '🛒', '📝', '🎯',
  '📅', '🧠', '⚽', '🎮', '📖', '🔬', '🧘', '💤', '☕', '💡', '📞', '🎨', '🔧', '🌱', '⭐', '🔥'];
