import { BROADCAST_INTERVAL } from '../constants';
import { serializeGameState } from './protocol';

// Process guest inputs and apply them to their ships
export function processGuestInputs(guestInputs, playerShips) {
  for (const ship of playerShips) {
    const inp = guestInputs.get(ship.id);
    if (!inp) continue;
    if (!ship.isSinking) {
      if (Math.abs(inp.joyY) > 0.1) ship.speed -= inp.joyY * ship.type.acceleration;
      if (Math.abs(inp.joyX) > 0.1) ship.angle += inp.joyX * ship.type.rotSpeed;
      if (inp.arrowUp) ship.speed += ship.type.acceleration;
      if (inp.arrowDown) ship.speed -= ship.type.acceleration * 0.5;
      if (inp.arrowLeft) ship.angle -= ship.type.rotSpeed;
      if (inp.arrowRight) ship.angle += ship.type.rotSpeed;
    }
    if (inp.fireL) {
      ship.fire('left', inp.powerL, null); // cannonballs added via return
      inp.fireL = false;
    }
    if (inp.fireR) {
      ship.fire('right', inp.powerR, null);
      inp.fireR = false;
    }
  }
}

// Broadcast game state to all guests
export function broadcastState(connection, entities, score, mode, frameCount) {
  if (frameCount % BROADCAST_INTERVAL !== 0) return;
  const state = serializeGameState(entities, score, mode);
  connection.send(state);
}
