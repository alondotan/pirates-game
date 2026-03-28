import React, { useCallback, useEffect, useRef, useState } from 'react';
import { WORLD, FIRE_COOLDOWN_MAX, AIM_SENSITIVITY, ZOOM, SHIP_TYPES, BROADCAST_INTERVAL, PLAYER_COLORS } from './constants';
import { Particle } from './entities/Particle';
import { SeaLife } from './entities/SeaLife';
import { Island } from './entities/Island';
import { Ship } from './entities/Ship';
import { Connection } from './multiplayer/connection';
import { serializeGameState, generateSeededIslands } from './multiplayer/protocol';
import { syncShipsFromState, syncCannonballsFromState, interpolateShips } from './multiplayer/guestRenderer';

const ShipPreview = ({ typeId }) => {
  const ref = useCallback((canvas) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Ship.drawPreview(ctx, canvas.width / 2, canvas.height / 2, SHIP_TYPES[typeId]);
  }, [typeId]);
  return <canvas ref={ref} width={160} height={100} className="mb-4" />;
};

const App = () => {
  const canvasRef = useRef(null);
  const mCanvasRef = useRef(null);
  const windCanvasRef = useRef(null);
  // gameState: 'menu' | 'lobby' | 'lobby-waiting' | 'playing' | 'gameover'
  const [gameState, setGameState] = useState('menu');
  const [score, setScore] = useState(0);
  const [cooldowns, setCooldowns] = useState({ L: 0, R: 0 });
  const [powers, setPowers] = useState({ L: 5, R: 5 });

  // Multiplayer state
  const [lobbyMode, setLobbyMode] = useState(null); // 'coop' | 'ffa'
  const [lobbyRole, setLobbyRole] = useState(null); // 'host' | 'guest'
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [myPlayerId, setMyPlayerId] = useState(null);
  const [lobbyPlayers, setLobbyPlayers] = useState([]);
  const [selectedShip, setSelectedShip] = useState('sloop');
  const [lobbyError, setLobbyError] = useState('');
  const connRef = useRef(null);
  const guestInputs = useRef(new Map()); // playerId -> latest input
  const networkState = useRef(null); // latest state snapshot from host (for guests)
  const frameCounter = useRef(0);
  const multiplayerMode = useRef(null); // 'coop' | 'ffa' | null (single player)

  const input = useRef({
    joyX: 0, joyY: 0, joyTouchId: null,
    isAimingL: false, fireTouchIdL: null, aimPowerL: 5, tempPowerStartL: 5, touchStartY_L: 0, queueFireL: false, finalPowerL: 5,
    isAimingR: false, fireTouchIdR: null, aimPowerR: 5, tempPowerStartR: 5, touchStartY_R: 0, queueFireR: false, finalPowerR: 5,
  });
  const keys = useRef({});
  const entities = useRef({
    player: null, playerShips: [], enemies: [], cannonballs: [], particles: [], islands: [], seaLife: [],
    camera: { x: 0, y: 0 }, clouds: [], seagulls: [], wind: { angle: 0 },
  });

  const spawnShipPos = (islandsList) => {
    let x, y, tries = 0;
    do {
      x = Math.random() * WORLD.width;
      y = Math.random() * WORLD.height;
      tries++;
    } while (tries < 100 && islandsList.some((isl) => isl.checkCollision(x, y, 60)));
    return { x, y };
  };

  const initDecorations = (islandsArr) => {
    entities.current.clouds = Array.from({ length: 25 }, () => ({
      x: Math.random() * WORLD.width, y: Math.random() * WORLD.height,
      s: 70 + Math.random() * 80, spd: 0.3 + Math.random() * 0.4,
    }));
    entities.current.seagulls = Array.from({ length: 50 }, () => ({
      x: Math.random() * WORLD.width, y: Math.random() * WORLD.height,
      a: Math.random() * Math.PI * 2, sp: 0.8 + Math.random(), w: 0,
    }));
    entities.current.cannonballs = [];
    entities.current.particles = [];
    const initialSeaLife = [];
    const spawnSeaPos = () => {
      let sx, sy, tries = 0;
      do {
        sx = 200 + Math.random() * (WORLD.width - 400);
        sy = 200 + Math.random() * (WORLD.height - 400);
        tries++;
      } while (tries < 50 && islandsArr.some((isl) => isl.checkCollision(sx, sy, 30)));
      return { sx, sy };
    };
    for (let f = 0; f < 10; f++) {
      const { sx, sy } = spawnSeaPos();
      const leader = new SeaLife(sx, sy, 'dolphin');
      initialSeaLife.push(leader);
      const flockSize = 4 + Math.floor(Math.random() * 5);
      for (let j = 0; j < flockSize; j++)
        initialSeaLife.push(new SeaLife(sx + (Math.random() - 0.5) * 80, sy + (Math.random() - 0.5) * 80, 'dolphin', leader));
    }
    for (let f = 0; f < 4; f++) {
      const { sx, sy } = spawnSeaPos();
      initialSeaLife.push(new SeaLife(sx, sy, 'whale'));
    }
    entities.current.seaLife = initialSeaLife;
  };

  // --- Single player start ---
  const startSinglePlayer = (type) => {
    multiplayerMode.current = null;
    const islandsArr = [];
    for (let i = 0; i < 8; i++) {
      let x, y, tries = 0;
      do {
        x = 600 + Math.random() * (WORLD.width - 1200);
        y = 600 + Math.random() * (WORLD.height - 1200);
        tries++;
      } while (
        tries < 200 &&
        (Math.hypot(x - WORLD.width / 2, y - WORLD.height / 2) < 1000 ||
          islandsArr.some((isl) => Math.hypot(x - isl.x, y - isl.y) < 600))
      );
      islandsArr.push(new Island(x, y, i < 4));
    }
    entities.current.islands = islandsArr;
    entities.current.player = new Ship(WORLD.width / 2, WORLD.height / 2, type, true);
    entities.current.playerShips = [];
    entities.current.enemies = Array.from({ length: 8 }, () => {
      const p = spawnShipPos(islandsArr);
      return new Ship(p.x, p.y, 'sloop');
    });
    initDecorations(islandsArr);
    setScore(0);
    setGameState('playing');
  };

  // --- Multiplayer: create room ---
  const createRoom = async (mode) => {
    setLobbyError('');
    const conn = new Connection();
    connRef.current = conn;
    try {
      await conn.connect();
    } catch {
      setLobbyError('לא ניתן להתחבר לשרת');
      return;
    }
    conn.on('room_created', (msg) => {
      setRoomCode(msg.code);
      setMyPlayerId(msg.playerId);
      setLobbyPlayers([{ id: msg.playerId, isHost: true, shipType: selectedShip }]);
      setLobbyRole('host');
      setLobbyMode(mode);
      setGameState('lobby-waiting');
    });
    conn.on('player_joined', (msg) => {
      setLobbyPlayers((prev) => [...prev, { id: msg.playerId, isHost: false, shipType: 'sloop' }]);
    });
    conn.on('select_ship', (msg) => {
      setLobbyPlayers((prev) => prev.map((p) => p.id === msg.from ? { ...p, shipType: msg.shipType } : p));
    });
    conn.on('player_disconnected', (msg) => {
      setLobbyPlayers((prev) => prev.filter((p) => p.id !== msg.playerId));
    });
    // Guest input during gameplay
    conn.on('input', (msg) => {
      guestInputs.current.set(msg.from, msg);
    });
    conn.on('_close', () => {
      if (gameState !== 'menu') setLobbyError('החיבור לשרת נותק');
    });
    conn.send({ type: 'create_room', mode });
  };

  // --- Multiplayer: join room ---
  const joinRoom = async () => {
    setLobbyError('');
    if (joinCode.length < 6) { setLobbyError('הכנס קוד בן 6 תווים'); return; }
    const conn = new Connection();
    connRef.current = conn;
    try {
      await conn.connect();
    } catch {
      setLobbyError('לא ניתן להתחבר לשרת');
      return;
    }
    conn.on('room_joined', (msg) => {
      setMyPlayerId(msg.playerId);
      setLobbyPlayers(msg.players.map((p) => ({ ...p, shipType: p.shipType || 'sloop' })));
      setLobbyRole('guest');
      setLobbyMode(msg.mode);
      setGameState('lobby-waiting');
    });
    conn.on('player_joined', (msg) => {
      setLobbyPlayers((prev) => [...prev, { id: msg.playerId, isHost: false, shipType: 'sloop' }]);
    });
    conn.on('select_ship', (msg) => {
      setLobbyPlayers((prev) => prev.map((p) => p.id === msg.from ? { ...p, shipType: msg.shipType } : p));
    });
    conn.on('player_disconnected', (msg) => {
      setLobbyPlayers((prev) => prev.filter((p) => p.id !== msg.playerId));
    });
    conn.on('host_disconnected', () => {
      setLobbyError('המארח התנתק');
      setGameState('menu');
    });
    conn.on('error', (msg) => {
      setLobbyError(msg.message);
    });
    conn.on('start_game', (msg) => {
      startMultiplayerGuest(msg);
    });
    conn.on('state', (msg) => {
      networkState.current = msg;
    });
    conn.on('game_over', () => {
      setGameState('gameover');
    });
    conn.on('_close', () => {
      if (gameState !== 'menu') setLobbyError('החיבור לשרת נותק');
    });
    conn.send({ type: 'join_room', code: joinCode.toUpperCase() });
  };

  // --- Host starts multiplayer game ---
  const startMultiplayerHost = () => {
    const seed = Math.floor(Math.random() * 2147483647);
    const players = lobbyPlayers.map((p, i) => ({ ...p, colorIndex: i }));

    // Tell guests to start
    connRef.current.send({ type: 'start_game', seed, players, mode: lobbyMode });

    multiplayerMode.current = lobbyMode;
    const islandsArr = generateSeededIslands(seed, WORLD.width, WORLD.height);
    entities.current.islands = islandsArr;

    // Create host player ship
    const hostPlayer = players.find((p) => p.isHost);
    const hostShip = new Ship(WORLD.width / 2, WORLD.height / 2, hostPlayer.shipType, true, hostPlayer.id);
    hostShip.playerColor = PLAYER_COLORS[hostPlayer.colorIndex];
    entities.current.player = hostShip;

    // Create guest player ships
    entities.current.playerShips = players.filter((p) => !p.isHost).map((p) => {
      const pos = spawnShipPos(islandsArr);
      const ship = new Ship(pos.x, pos.y, p.shipType, true, p.id);
      ship.playerColor = PLAYER_COLORS[p.colorIndex];
      return ship;
    });

    entities.current.enemies = Array.from({ length: 8 }, () => {
      const p = spawnShipPos(islandsArr);
      return new Ship(p.x, p.y, 'sloop');
    });
    initDecorations(islandsArr);
    frameCounter.current = 0;
    setScore(0);
    setGameState('playing');
  };

  // --- Guest starts multiplayer game ---
  const startMultiplayerGuest = (msg) => {
    multiplayerMode.current = msg.mode;
    const islandsArr = generateSeededIslands(msg.seed, WORLD.width, WORLD.height);
    entities.current.islands = islandsArr;
    entities.current.player = null;
    entities.current.playerShips = [];
    entities.current.enemies = [];
    entities.current.cannonballs = [];
    // We store myPlayerId for camera tracking
    networkState.current = null;
    initDecorations(islandsArr);
    setScore(0);
    setGameState('playing');
  };

  // Ship selection broadcast
  const selectShipInLobby = (type) => {
    setSelectedShip(type);
    setLobbyPlayers((prev) => prev.map((p) => p.id === myPlayerId ? { ...p, shipType: type } : p));
    if (connRef.current) connRef.current.send({ type: 'select_ship', shipType: type });
  };

  // Cleanup connection on unmount
  useEffect(() => {
    return () => { if (connRef.current) connRef.current.disconnect(); };
  }, []);

  // Keyboard controls
  useEffect(() => {
    const onKeyDown = (e) => {
      keys.current[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyW') { input.current.aimPowerL = Math.min(13, input.current.aimPowerL + 0.5); input.current.aimPowerR = Math.min(13, input.current.aimPowerR + 0.5); input.current.isAimingL = true; input.current.isAimingR = true; }
      if (e.code === 'KeyS') { input.current.aimPowerL = Math.max(1, input.current.aimPowerL - 0.5); input.current.aimPowerR = Math.max(1, input.current.aimPowerR - 0.5); input.current.isAimingL = true; input.current.isAimingR = true; }
      if (e.code === 'KeyA' && !e.repeat) { input.current.finalPowerL = input.current.aimPowerL; input.current.queueFireL = true; }
      if (e.code === 'KeyD' && !e.repeat) { input.current.finalPowerR = input.current.aimPowerR; input.current.queueFireR = true; }
    };
    const onKeyUp = (e) => {
      keys.current[e.code] = false;
      if (e.code === 'KeyW' || e.code === 'KeyS') { input.current.isAimingL = false; input.current.isAimingR = false; }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  // === GAME LOOP ===
  useEffect(() => {
    let frameId;
    const loop = () => {
      if (gameState !== 'playing') { frameId = requestAnimationFrame(loop); return; }
      const canvas = canvasRef.current;
      if (!canvas) { frameId = requestAnimationFrame(loop); return; }
      try {
      const ctx = canvas.getContext('2d');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const isHost = lobbyRole !== 'guest';
      const isGuest = lobbyRole === 'guest';
      const isMultiplayer = multiplayerMode.current !== null;
      const mode = multiplayerMode.current;
      const { islands, camera, clouds, seagulls, wind } = entities.current;
      let { player, playerShips, enemies, cannonballs, particles, seaLife } = entities.current;

      // --- GUEST LOOP ---
      if (isGuest) {
        const ns = networkState.current;
        if (ns) {
          // Send our input to host
          if (connRef.current) {
            connRef.current.send({
              type: 'input',
              joyX: input.current.joyX, joyY: input.current.joyY,
              arrowUp: !!keys.current['ArrowUp'], arrowDown: !!keys.current['ArrowDown'],
              arrowLeft: !!keys.current['ArrowLeft'], arrowRight: !!keys.current['ArrowRight'],
              fireL: input.current.queueFireL, fireR: input.current.queueFireR,
              powerL: input.current.finalPowerL, powerR: input.current.finalPowerR,
            });
            input.current.queueFireL = false;
            input.current.queueFireR = false;
          }

          // Sync ships from network
          const allLocalShips = [...(player ? [player] : []), ...playerShips, ...enemies];
          const allSynced = syncShipsFromState(ns.ships, allLocalShips, myPlayerId);

          // Split into player ships and enemies
          const newPlayerShips = [];
          let newPlayer = null;
          const newEnemies = [];
          for (const s of allSynced) {
            if (s.isPlayer) {
              if (s.id === myPlayerId) newPlayer = s;
              else newPlayerShips.push(s);
            } else {
              newEnemies.push(s);
            }
          }

          entities.current.player = newPlayer;
          entities.current.playerShips = newPlayerShips;
          entities.current.enemies = newEnemies;
          entities.current.cannonballs = syncCannonballsFromState(ns.cannonballs, cannonballs);
          wind.angle = ns.wind;
          setScore(ns.score || 0);

          player = entities.current.player;
          playerShips = entities.current.playerShips;
          enemies = entities.current.enemies;
          cannonballs = entities.current.cannonballs;

          // Interpolate
          interpolateShips([...(player ? [player] : []), ...playerShips, ...enemies], 0.3);
        }

        // Camera follows my ship
        if (player) {
          camera.x = player.x - (canvas.width / 2) / ZOOM;
          camera.y = player.y - (canvas.height / 2) / ZOOM;
          setCooldowns({ L: player.cooldownL, R: player.cooldownR });
        }
        setPowers({ L: input.current.aimPowerL, R: input.current.aimPowerR });

        // Update local cannonball physics prediction
        cannonballs.forEach((cb) => cb.update());

        // Check game over
        if (player && player.sinkProgress >= 0.9) {
          if (mode === 'coop') {
            const allPlayersDead = !playerShips.some((s) => s.sinkProgress < 0.9);
            if (allPlayersDead) setGameState('gameover');
          } else {
            setGameState('gameover');
          }
        }
      }

      // --- HOST / SINGLE-PLAYER LOOP ---
      if (isHost) {
        if (!player) { frameId = requestAnimationFrame(loop); return; }
        frameCounter.current++;
        wind.angle += 0.0004;

        // Host player input
        if (!player.isSinking) {
          if (Math.abs(input.current.joyY) > 0.1) player.speed -= input.current.joyY * player.type.acceleration;
          if (Math.abs(input.current.joyX) > 0.1) player.angle += input.current.joyX * player.type.rotSpeed;
          if (keys.current['ArrowUp']) player.speed += player.type.acceleration;
          if (keys.current['ArrowDown']) player.speed -= player.type.acceleration * 0.5;
          if (keys.current['ArrowLeft']) player.angle -= player.type.rotSpeed;
          if (keys.current['ArrowRight']) player.angle += player.type.rotSpeed;
        }
        player.update(islands, null, cannonballs, particles, wind);
        camera.x = player.x - (canvas.width / 2) / ZOOM;
        camera.y = player.y - (canvas.height / 2) / ZOOM;

        // Fire queues (host player)
        if (input.current.queueFireL) { player.fire('left', input.current.finalPowerL, cannonballs); input.current.queueFireL = false; }
        if (input.current.queueFireR) { player.fire('right', input.current.finalPowerR, cannonballs); input.current.queueFireR = false; }
        setCooldowns({ L: player.cooldownL, R: player.cooldownR });
        setPowers({ L: input.current.aimPowerL, R: input.current.aimPowerR });

        // Process guest inputs (multiplayer host)
        if (isMultiplayer) {
          for (const gShip of playerShips) {
            const inp = guestInputs.current.get(gShip.id);
            if (!inp || gShip.isSinking) continue;
            if (Math.abs(inp.joyY) > 0.1) gShip.speed -= inp.joyY * gShip.type.acceleration;
            if (Math.abs(inp.joyX) > 0.1) gShip.angle += inp.joyX * gShip.type.rotSpeed;
            if (inp.arrowUp) gShip.speed += gShip.type.acceleration;
            if (inp.arrowDown) gShip.speed -= gShip.type.acceleration * 0.5;
            if (inp.arrowLeft) gShip.angle -= gShip.type.rotSpeed;
            if (inp.arrowRight) gShip.angle += gShip.type.rotSpeed;
            if (inp.fireL) { gShip.fire('left', inp.powerL, cannonballs); inp.fireL = false; }
            if (inp.fireR) { gShip.fire('right', inp.powerR, cannonballs); inp.fireR = false; }
            gShip.update(islands, null, cannonballs, particles, wind);
          }
        }

        // All player ships for targeting
        const allPlayerShips = [player, ...playerShips];

        // Update islands — fortress targets all player ships
        islands.forEach((isl) => isl.update([...enemies, ...allPlayerShips], cannonballs));

        // Update enemies — AI targets nearest player ship
        for (let i = enemies.length - 1; i >= 0; i--) {
          // Find nearest player ship for this enemy
          let nearestPlayer = player;
          let nearestDist = Math.hypot(enemies[i].x - player.x, enemies[i].y - player.y);
          for (const ps of playerShips) {
            const d = Math.hypot(enemies[i].x - ps.x, enemies[i].y - ps.y);
            if (d < nearestDist) { nearestDist = d; nearestPlayer = ps; }
          }
          enemies[i].update(islands, nearestPlayer, cannonballs, particles, wind);
          if (enemies[i].sinkProgress >= 1) enemies.splice(i, 1);
        }

        // Decorations
        clouds.forEach((c) => {
          c.x += Math.cos(wind.angle) * c.spd;
          c.y += Math.sin(wind.angle) * c.spd;
          if (c.x > WORLD.width + 200) c.x = -200; if (c.x < -200) c.x = WORLD.width + 200;
          if (c.y > WORLD.height + 200) c.y = -200; if (c.y < -200) c.y = WORLD.height + 200;
        });
        seagulls.forEach((s) => {
          s.x += Math.cos(s.a) * s.sp; s.y += Math.sin(s.a) * s.sp; s.w += 0.15;
          if (s.x > WORLD.width) s.x = 0; if (s.x < 0) s.x = WORLD.width;
          if (s.y > WORLD.height) s.y = 0; if (s.y < 0) s.y = WORLD.height;
        });

        // Sea life
        if (Math.random() < 0.015 && seaLife.length < 50) {
          const sx = Math.random() * WORLD.width, sy = Math.random() * WORLD.height;
          if (!islands.some((isl) => isl.checkCollision(sx, sy, 70))) {
            const l = new SeaLife(sx, sy, Math.random() > 0.85 ? 'whale' : 'dolphin');
            seaLife.push(l);
            if (l.type === 'dolphin') {
              const flockSize = 3 + Math.floor(Math.random() * 6);
              for (let j = 0; j < flockSize; j++)
                seaLife.push(new SeaLife(sx + (Math.random() - 0.5) * 80, sy + (Math.random() - 0.5) * 80, 'dolphin', l));
            }
          }
        }
        for (let i = seaLife.length - 1; i >= 0; i--) {
          seaLife[i].update(islands, particles);
          if (seaLife[i].life <= 0) seaLife.splice(i, 1);
        }

        // Cannonball collisions
        const allTargets = mode === 'ffa' ? [...allPlayerShips, ...enemies] : [player, ...playerShips, ...enemies];
        for (let i = cannonballs.length - 1; i >= 0; i--) {
          const b = cannonballs[i];
          b.update(particles);
          for (const s of allTargets) {
            if (s.isSinking || s === b.owner) continue;
            // In coop, player cannonballs don't hit other players
            if (mode === 'coop' && b.owner && b.owner.isPlayer && s.isPlayer) continue;
            if (Math.hypot(b.x - s.x, b.y - s.y) < 30 && b.z < 10 && b.vz < 0) {
              s.health -= (b.owner instanceof Island) ? 35 : 45;
              b.active = false;
              particles.push(new Particle(b.x, b.y, 'fire', 5, 20));
              if (s.health <= 0 && !s.isPlayer) {
                setScore((p) => p + 100);
                setTimeout(() => { const p = spawnShipPos(islands); entities.current.enemies.push(new Ship(p.x, p.y, 'sloop')); }, 8000);
              }
            }
          }
          if (!b.active) cannonballs.splice(i, 1);
        }

        // Particles
        for (let i = particles.length - 1; i >= 0; i--) {
          particles[i].update();
          if (particles[i].life <= 0) particles.splice(i, 1);
        }

        // Game over check
        if (isMultiplayer) {
          if (mode === 'coop') {
            const allDead = allPlayerShips.every((s) => s.sinkProgress >= 0.9);
            if (allDead) {
              if (connRef.current) connRef.current.send({ type: 'game_over' });
              setGameState('gameover');
            }
          } else {
            // FFA: check if only one player standing
            const alive = allPlayerShips.filter((s) => s.sinkProgress < 0.9);
            if (alive.length <= 1 && allPlayerShips.length > 1) {
              if (connRef.current) connRef.current.send({ type: 'game_over', winnerId: alive[0]?.id });
              setGameState('gameover');
            }
          }
        } else {
          if (player.sinkProgress >= 0.9) setGameState('gameover');
        }

        // Broadcast state to guests
        if (isMultiplayer && connRef.current && frameCounter.current % BROADCAST_INTERVAL === 0) {
          connRef.current.send(serializeGameState(entities.current, score, mode));
        }
      }

      // === DRAW (same for host and guest) ===
      const allShips = [...(player ? [player] : []), ...playerShips];

      ctx.save();
      ctx.scale(ZOOM, ZOOM);
      ctx.translate(-camera.x, -camera.y);

      ctx.fillStyle = '#004a7c';
      ctx.fillRect(camera.x, camera.y, canvas.width / ZOOM, canvas.height / ZOOM);
      ctx.fillStyle = '#0077be';
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);

      islands.forEach((isl) => isl.draw(ctx));
      if (!isGuest) seaLife.forEach((s) => s.draw(ctx));
      particles.forEach((p) => p.draw(ctx));
      enemies.forEach((e) => e.draw(ctx, false, 0, false, 0));
      // Draw other player ships
      for (const ps of playerShips) ps.draw(ctx, false, 0, false, 0);
      // Draw my ship with aim arcs
      if (player) player.draw(ctx, input.current.isAimingL, input.current.aimPowerL, input.current.isAimingR, input.current.aimPowerR);
      cannonballs.forEach((b) => b.draw(ctx));

      seagulls.forEach((s) => {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a);
        const wY = Math.sin(s.w) * 3;
        ctx.fillStyle = 'white'; ctx.beginPath(); ctx.ellipse(0, 0, 3, 1.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'white'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-1, -5 + wY); ctx.quadraticCurveTo(-0.5, -1, 0, 0); ctx.quadraticCurveTo(0.5, -1, 1, -5 + wY); ctx.stroke();
        ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(3, 0, 1, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      clouds.forEach((c) => {
        ctx.save(); ctx.globalAlpha = 0.9; ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.s, 0, Math.PI * 2);
        ctx.arc(c.x + c.s * 0.6, c.y, c.s * 0.8, 0, Math.PI * 2);
        ctx.arc(c.x - c.s * 0.5, c.y + 10, c.s * 0.7, 0, Math.PI * 2);
        ctx.fill(); ctx.restore();
      });

      ctx.restore();

      // Minimap
      if (mCanvasRef.current) {
        const mctx = mCanvasRef.current.getContext('2d');
        mctx.clearRect(0, 0, 100, 100);
        const sc = 100 / WORLD.width;
        islands.forEach((isl) => {
          mctx.fillStyle = '#f2d2a9';
          isl.circles.forEach((c) => {
            mctx.beginPath(); mctx.arc((isl.x + c.ox) * sc, (isl.y + c.oy) * sc, c.r * sc, 0, Math.PI * 2); mctx.fill();
          });
          if (isl.isFortress) {
            mctx.fillStyle = '#ff0000'; mctx.beginPath(); mctx.arc(isl.fortX * sc, isl.fortY * sc, 3, 0, Math.PI * 2); mctx.fill();
          }
        });
        // Show all player ships
        allShips.forEach((ship) => {
          if (!ship.isSinking) {
            mctx.fillStyle = ship.playerColor || '#fff';
            mctx.beginPath(); mctx.arc(ship.x * sc, ship.y * sc, 3, 0, Math.PI * 2); mctx.fill();
          }
        });
        enemies.forEach((ship) => {
          if (!ship.isSinking) {
            mctx.fillStyle = '#ef4444';
            mctx.beginPath(); mctx.arc(ship.x * sc, ship.y * sc, 3, 0, Math.PI * 2); mctx.fill();
          }
        });
      }

      // Wind compass
      if (windCanvasRef.current) {
        const wctx = windCanvasRef.current.getContext('2d');
        wctx.clearRect(0, 0, 48, 48);
        wctx.save(); wctx.translate(24, 24); wctx.rotate(wind.angle + Math.PI / 2);
        wctx.strokeStyle = 'rgba(255,255,255,0.8)'; wctx.lineWidth = 2;
        wctx.beginPath(); wctx.moveTo(0, 10); wctx.lineTo(0, -10); wctx.stroke();
        wctx.fillStyle = '#f59e0b';
        wctx.beginPath(); wctx.moveTo(0, -16); wctx.lineTo(-5, -8); wctx.lineTo(5, -8); wctx.closePath(); wctx.fill();
        wctx.fillStyle = 'rgba(255,255,255,0.5)';
        wctx.beginPath(); wctx.moveTo(-3, 10); wctx.lineTo(0, 14); wctx.lineTo(3, 10); wctx.closePath(); wctx.fill();
        wctx.restore();
      }

      } catch (err) {
        console.error('Game loop error:', err);
      }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [gameState, lobbyRole, myPlayerId]);

  // --- Touch handlers ---
  const onTS = (e) => {
    if (gameState !== 'playing') return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth / 2) { input.current.joyTouchId = t.identifier; upJ(t); }
      else {
        const bL = document.getElementById('btnLZone')?.getBoundingClientRect();
        const bR = document.getElementById('btnRZone')?.getBoundingClientRect();
        if (bL && t.clientX >= bL.left && t.clientX <= bL.right && t.clientY >= bL.top && t.clientY <= bL.bottom) {
          input.current.fireTouchIdL = t.identifier; input.current.isAimingL = true;
          input.current.touchStartY_L = t.clientY; input.current.tempPowerStartL = input.current.aimPowerL;
        } else if (bR && t.clientX >= bR.left && t.clientX <= bR.right && t.clientY >= bR.top && t.clientY <= bR.bottom) {
          input.current.fireTouchIdR = t.identifier; input.current.isAimingR = true;
          input.current.touchStartY_R = t.clientY; input.current.tempPowerStartR = input.current.aimPowerR;
        }
      }
    }
  };
  const onTM = (e) => {
    if (gameState !== 'playing') return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === input.current.joyTouchId) upJ(t);
      else if (t.identifier === input.current.fireTouchIdL) input.current.aimPowerL = Math.max(1, Math.min(13, input.current.tempPowerStartL + (input.current.touchStartY_L - t.clientY) * AIM_SENSITIVITY));
      else if (t.identifier === input.current.fireTouchIdR) input.current.aimPowerR = Math.max(1, Math.min(13, input.current.tempPowerStartR + (input.current.touchStartY_R - t.clientY) * AIM_SENSITIVITY));
    }
  };
  const onTE = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === input.current.joyTouchId) { input.current.joyTouchId = null; input.current.joyX = 0; input.current.joyY = 0; }
      else if (t.identifier === input.current.fireTouchIdL) { input.current.finalPowerL = input.current.aimPowerL; input.current.queueFireL = true; input.current.isAimingL = false; input.current.fireTouchIdL = null; }
      else if (t.identifier === input.current.fireTouchIdR) { input.current.finalPowerR = input.current.aimPowerR; input.current.queueFireR = true; input.current.isAimingR = false; input.current.fireTouchIdR = null; }
    }
  };
  const upJ = (t) => {
    const jB = document.getElementById('joyBase')?.getBoundingClientRect();
    if (!jB) return;
    const dX = t.clientX - (jB.left + jB.width / 2), dY = t.clientY - (jB.top + jB.height / 2);
    const d = Math.min(45, Math.hypot(dX, dY)), a = Math.atan2(dY, dX);
    input.current.joyX = (Math.cos(a) * d) / 45; input.current.joyY = (Math.sin(a) * d) / 45;
  };

  const backToMenu = () => {
    if (connRef.current) { connRef.current.disconnect(); connRef.current = null; }
    multiplayerMode.current = null;
    setLobbyRole(null);
    setLobbyMode(null);
    setRoomCode('');
    setJoinCode('');
    setLobbyPlayers([]);
    setLobbyError('');
    setGameState('menu');
  };

  return (
    <div className={`relative w-full h-screen bg-sky-900 select-none ${gameState === 'playing' ? 'overflow-hidden touch-none' : 'overflow-y-auto'}`} onTouchStart={onTS} onTouchMove={onTM} onTouchEnd={onTE}>
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* === MAIN MENU === */}
      {gameState === 'menu' && (
        <div className="absolute inset-0 z-[200] bg-slate-900/95 flex flex-col items-center justify-center p-6 text-center text-white backdrop-blur-md">
          <h1 className="text-5xl font-black italic mb-2 text-amber-500 uppercase tracking-tighter">Pirate Captain</h1>
          <p className="text-xl opacity-70 mb-8">בחר ספינה וצא לים הפתוח</p>

          {/* Single player ship selection */}
          <div className="flex gap-8 flex-wrap justify-center mb-10">
            {Object.entries(SHIP_TYPES).map(([id, ship]) => (
              <button key={id} onClick={() => startSinglePlayer(id)} className="w-52 p-6 bg-white/5 border-2 border-white/20 rounded-3xl hover:bg-white/10 hover:border-amber-500 transition-all active:scale-95 flex flex-col items-center">
                <ShipPreview typeId={id} />
                <div className="text-2xl font-bold mb-3 text-amber-100">{ship.name}</div>
                <div className="text-sm opacity-60 mb-6 text-right space-y-1">
                  <div>{ship.cannons === 1 ? 'תותח בודד' : 'זוג תותחים'} &bull;</div>
                  <div>{ship.health} חיים &bull;</div>
                </div>
                <div className="bg-amber-600 px-10 py-3 rounded-full font-black uppercase text-sm shadow-lg">הפלג</div>
              </button>
            ))}
          </div>

          {/* Multiplayer buttons */}
          <div className="border-t border-white/10 pt-8 w-full max-w-lg">
            <p className="text-lg font-bold mb-4 text-amber-400">מרובה שחקנים</p>
            <div className="flex gap-4 justify-center flex-wrap">
              <button onClick={() => setGameState('lobby')} className="px-8 py-3 bg-blue-600 rounded-full font-bold text-sm hover:bg-blue-500 active:scale-95 transition-all">
                צור / הצטרף למשחק
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === LOBBY: CREATE OR JOIN === */}
      {gameState === 'lobby' && (
        <div className="absolute inset-0 z-[200] bg-slate-900/95 flex flex-col items-center justify-center p-6 text-center text-white backdrop-blur-md">
          <h1 className="text-4xl font-black italic mb-8 text-amber-500 uppercase">מרובה שחקנים</h1>

          {lobbyError && <div className="bg-red-600/80 px-6 py-2 rounded-xl mb-6 text-sm">{lobbyError}</div>}

          <div className="flex gap-8 flex-wrap justify-center mb-8">
            {/* Create game */}
            <div className="w-64 p-6 bg-white/5 border-2 border-white/20 rounded-3xl flex flex-col items-center gap-4">
              <h2 className="text-xl font-bold text-amber-100">צור משחק</h2>
              <button onClick={() => createRoom('coop')} className="w-full px-6 py-3 bg-green-600 rounded-full font-bold text-sm hover:bg-green-500 active:scale-95 transition-all">
                שיתופי (Co-op)
              </button>
              <button onClick={() => createRoom('ffa')} className="w-full px-6 py-3 bg-red-600 rounded-full font-bold text-sm hover:bg-red-500 active:scale-95 transition-all">
                כל אחד לעצמו (FFA)
              </button>
            </div>

            {/* Join game */}
            <div className="w-64 p-6 bg-white/5 border-2 border-white/20 rounded-3xl flex flex-col items-center gap-4">
              <h2 className="text-xl font-bold text-amber-100">הצטרף למשחק</h2>
              <input
                type="text" maxLength={6} placeholder="הכנס קוד"
                value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 bg-black/40 border-2 border-white/20 rounded-xl text-center text-2xl font-mono tracking-[0.3em] placeholder:text-white/30 focus:border-amber-500 outline-none"
              />
              <button onClick={joinRoom} className="w-full px-6 py-3 bg-blue-600 rounded-full font-bold text-sm hover:bg-blue-500 active:scale-95 transition-all">
                הצטרף
              </button>
            </div>
          </div>

          <button onClick={backToMenu} className="text-white/50 hover:text-white text-sm underline">חזרה לתפריט</button>
        </div>
      )}

      {/* === LOBBY: WAITING ROOM === */}
      {gameState === 'lobby-waiting' && (
        <div className="absolute inset-0 z-[200] bg-slate-900/95 flex flex-col items-center justify-center p-6 text-center text-white backdrop-blur-md">
          <h1 className="text-4xl font-black italic mb-2 text-amber-500 uppercase">
            {lobbyMode === 'coop' ? 'שיתופי' : 'כל אחד לעצמו'}
          </h1>

          {lobbyError && <div className="bg-red-600/80 px-6 py-2 rounded-xl mb-4 text-sm">{lobbyError}</div>}

          {/* Room code */}
          <div className="mb-8">
            <p className="text-sm opacity-60 mb-2">קוד חדר</p>
            <div className="text-5xl font-mono font-black tracking-[0.4em] text-amber-400">{roomCode}</div>
          </div>

          {/* Players list */}
          <div className="mb-8 w-full max-w-md">
            <p className="text-sm opacity-60 mb-3">שחקנים ({lobbyPlayers.length}/4)</p>
            <div className="flex flex-col gap-2">
              {lobbyPlayers.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3 bg-white/5 rounded-xl">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: PLAYER_COLORS[i] }} />
                  <span className="font-bold flex-1 text-right">{p.id === myPlayerId ? 'אני' : p.id} {p.isHost ? '(מארח)' : ''}</span>
                  <span className="text-xs opacity-60">{SHIP_TYPES[p.shipType]?.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Ship selection */}
          <div className="mb-8">
            <p className="text-sm opacity-60 mb-3">בחר ספינה</p>
            <div className="flex gap-4 justify-center">
              {Object.entries(SHIP_TYPES).map(([id, ship]) => (
                <button key={id} onClick={() => selectShipInLobby(id)}
                  className={`px-6 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 ${selectedShip === id ? 'bg-amber-600 border-2 border-amber-400' : 'bg-white/10 border-2 border-white/20 hover:bg-white/20'}`}>
                  {ship.name}
                </button>
              ))}
            </div>
          </div>

          {/* Start button (host only) */}
          {lobbyRole === 'host' && lobbyPlayers.length >= 2 && (
            <button onClick={startMultiplayerHost} className="px-16 py-5 bg-green-600 rounded-full font-black text-xl shadow-2xl active:scale-95 border-b-4 border-green-800 uppercase tracking-tighter mb-4">
              התחל משחק
            </button>
          )}
          {lobbyRole === 'host' && lobbyPlayers.length < 2 && (
            <p className="text-white/40 text-sm mb-4">ממתין לשחקנים...</p>
          )}
          {lobbyRole === 'guest' && (
            <p className="text-white/40 text-sm mb-4">ממתין שהמארח יתחיל...</p>
          )}

          <button onClick={backToMenu} className="text-white/50 hover:text-white text-sm underline">עזוב חדר</button>
        </div>
      )}

      {/* === PLAYING HUD === */}
      {gameState === 'playing' && (
        <>
          <div className="absolute top-6 right-6 text-white text-right pointer-events-none drop-shadow-lg">
            <h1 className="text-xl font-black italic text-amber-500">PIRATE CAPTAIN</h1>
            <p className="text-lg font-bold">שלל: {score}</p>
            {multiplayerMode.current && (
              <p className="text-xs opacity-50">{multiplayerMode.current === 'coop' ? 'שיתופי' : 'FFA'} | {roomCode}</p>
            )}
          </div>
          <div className="absolute top-6 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
            <canvas ref={windCanvasRef} width={48} height={48} className="rounded-full border border-white/30 bg-black/40" />
            <span className="text-[8px] text-white font-bold opacity-60">רוח</span>
          </div>
          <canvas ref={mCanvasRef} width={100} height={100} className="absolute top-6 left-6 rounded-full border-2 border-white/20 bg-black/40" />
          <div className="hidden md:block absolute bottom-6 right-6 pointer-events-none text-white/40 text-[10px] leading-relaxed text-right">
            <div>חצים - הגה ומפרשים</div>
            <div>A / D - ירי שמאל / ימין</div>
            <div>W / S - עוצמת ירי</div>
          </div>
          <div className="absolute bottom-12 left-0 right-0 px-8 flex justify-between items-end pointer-events-none">
            <div id="joyBase" className="w-24 h-24 rounded-full bg-white/10 border-2 border-white/20 relative">
              <div className="w-10 h-10 rounded-full bg-white shadow-2xl absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ transform: `translate(calc(-50% + ${input.current.joyX * 35}px), calc(-50% + ${input.current.joyY * 35}px))` }} />
            </div>
            <div className="flex gap-4">
              {['L', 'R'].map((side) => (
                <div key={side} id={`btn${side}Zone`} className="flex flex-col items-center gap-2">
                  <div className="w-16 h-28 rounded-2xl border-2 border-white/30 bg-black/50 relative overflow-hidden flex flex-col items-center justify-end p-2 shadow-xl">
                    <div className="w-full bg-amber-500/80 rounded-t-lg shadow-inner" style={{ height: `${(powers[side] / 13) * 100}%` }} />
                    <div className="absolute inset-0 bg-black/60 transition-all duration-100" style={{ height: `${(cooldowns[side] / FIRE_COOLDOWN_MAX) * 100}%` }} />
                    <span className="absolute inset-0 flex items-center justify-center text-white font-black text-[10px]">ירי {side === 'L' ? 'שמאל' : 'ימין'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* === GAME OVER === */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center text-white p-8 text-center z-[300] backdrop-blur-xl">
          <h2 className="text-6xl font-black mb-4 text-red-600 italic uppercase">טבעת!</h2>
          <p className="text-2xl mb-8 font-bold">שלל סופי: {score}</p>
          <button onClick={backToMenu} className="px-16 py-5 bg-amber-600 rounded-full font-black text-xl shadow-2xl active:scale-95 border-b-4 border-amber-800 uppercase tracking-tighter pointer-events-auto">חזור לנמל</button>
        </div>
      )}
    </div>
  );
};

export default App;
