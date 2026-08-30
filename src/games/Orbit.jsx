import { useEffect, useRef, useState } from "react";

const W = 384;
const H = 320;

function spawnRocks(n) {
  return Array.from({ length: n }, () => {
    const angle = Math.random() * Math.PI * 2;
    return {
      x: W / 2 + Math.cos(angle) * 140,
      y: H / 2 + Math.sin(angle) * 110,
      vx: Math.cos(angle + 1) * 1.1,
      vy: Math.sin(angle + 1) * 1.1,
      r: 16 + Math.random() * 10,
      live: true,
    };
  });
}

export default function Orbit({ onOver }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const [hud, setHud] = useState({ score: 0, stage: 1, live: true });

  useEffect(() => {
    const state = {
      ship: { x: W / 2, y: H / 2, a: 0, vx: 0, vy: 0 },
      rocks: spawnRocks(3),
      shots: [],
      keys: {},
      score: 0,
      stage: 1,
      dead: false,
      cool: 0,
    };
    stateRef.current = state;

    const down = (e) => {
      state.keys[e.key] = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
        e.preventDefault();
      }
    };
    const up = (e) => {
      state.keys[e.key] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    let raf;
    const tick = () => {
      const s = stateRef.current;
      if (!s.dead) {
        if (s.keys.ArrowLeft || s.keys.a) s.ship.a -= 0.08;
        if (s.keys.ArrowRight || s.keys.d) s.ship.a += 0.08;
        if (s.keys.ArrowUp || s.keys.w) {
          s.ship.vx += Math.cos(s.ship.a) * 0.18;
          s.ship.vy += Math.sin(s.ship.a) * 0.18;
        }
        s.ship.vx *= 0.99;
        s.ship.vy *= 0.99;
        s.ship.x = (s.ship.x + s.ship.vx + W) % W;
        s.ship.y = (s.ship.y + s.ship.vy + H) % H;
        s.cool -= 1;
        if ((s.keys[" "] || s.keys.Shift) && s.cool <= 0) {
          s.shots.push({
            x: s.ship.x,
            y: s.ship.y,
            vx: Math.cos(s.ship.a) * 6,
            vy: Math.sin(s.ship.a) * 6,
            life: 40,
          });
          s.cool = 12;
        }
        s.shots = s.shots
          .map((sh) => ({ ...sh, x: sh.x + sh.vx, y: sh.y + sh.vy, life: sh.life - 1 }))
          .filter((sh) => sh.life > 0);
        s.rocks.forEach((r) => {
          if (!r.live) return;
          r.x = (r.x + r.vx + W) % W;
          r.y = (r.y + r.vy + H) % H;
          const dx = r.x - s.ship.x;
          const dy = r.y - s.ship.y;
          if (dx * dx + dy * dy < (r.r + 6) * (r.r + 6)) {
            s.dead = true;
            onOver({ stages: s.stage, score: s.score });
          }
          s.shots.forEach((sh) => {
            const sx = r.x - sh.x;
            const sy = r.y - sh.y;
            if (sx * sx + sy * sy < r.r * r.r) {
              r.live = false;
              sh.life = 0;
              s.score += 80 * s.stage;
            }
          });
        });
        if (s.rocks.every((r) => !r.live)) {
          s.stage += 1;
          s.rocks = spawnRocks(2 + s.stage);
        }
        setHud({ score: s.score, stage: s.stage, live: !s.dead });
      }
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) draw(ctx, s);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [onOver]);

  return (
    <div className="cabinet-play">
      <div className="cabinet-hud">
        <span>ORBIT</span>
        <span>WAVE {hud.stage}</span>
        <span>{hud.score}</span>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      <p className="hint">A · D turn · W thrust · Space fire</p>
    </div>
  );
}

function draw(ctx, s) {
  ctx.fillStyle = "#04110c";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#3ee07a";
  ctx.lineWidth = 2;
  s.rocks.forEach((r) => {
    if (!r.live) return;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.strokeStyle = "#ffe27a";
  s.shots.forEach((sh) => {
    ctx.beginPath();
    ctx.moveTo(sh.x, sh.y);
    ctx.lineTo(sh.x - sh.vx * 1.4, sh.y - sh.vy * 1.4);
    ctx.stroke();
  });
  ctx.save();
  ctx.translate(s.ship.x, s.ship.y);
  ctx.rotate(s.ship.a);
  ctx.fillStyle = "#f4fff4";
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-8, 7);
  ctx.lineTo(-8, -7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (s.dead) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ff6b6b";
    ctx.font = "14px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", W / 2, H / 2);
  }
}
