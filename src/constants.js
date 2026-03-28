export const WORLD = { width: 5000, height: 5000 };
export const FIRE_COOLDOWN_MAX = 120;
export const GRAVITY = 0.05;
export const AIM_SENSITIVITY = 0.015;
export const ZOOM = 0.65;

// Multiplayer
export const BROADCAST_INTERVAL = 3; // send state every N frames
export const MAX_PLAYERS = 4;
export const PLAYER_COLORS = ['#5d4037', '#1565c0', '#2e7d32', '#6a1b9a'];

export const SHIP_TYPES = {
  sloop: {
    name: "מהירה (Sloop)",
    color: "#5d4037",
    maxSpeed: 0.8,
    rotSpeed: 0.01,
    acceleration: 0.015,
    health: 100,
    cannons: 1,
    sizeScale: 1,
  },
  galleon: {
    name: "מלחמה (Galleon)",
    color: "#4e342e",
    maxSpeed: 0.55,
    rotSpeed: 0.008,
    acceleration: 0.01,
    health: 160,
    cannons: 2,
    sizeScale: 1.25,
  },
};
