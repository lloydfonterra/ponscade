import { useEffect, useRef, useState } from "react";

const W = 384;
const H = 320;

function makeBricks(stage) {
  const rows = Math.min(6, 3 + stage);
  const cols = 8;
  const bricks = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      bricks.push({
        x: 16 + c * 44,
        y: 28 + r * 18,
        w: 40,
        h: 14,
        live: true,
      });
    }
  }
  return bricks;
}

export default function Breaker({ onOver }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const [hud, setHud] = useState({ score: 0, stage: 1, live: true });

  useEffect(() => {
    const state = {
      paddle: { x: W / 2 - 36, w: 72 },
      ball: { x: W / 2, y: 240, vx: 3.2, vy: -3.6 },
      bricks: makeBricks(1),
      score: 0,
      stage: 1,
      dead: false,
      keys: { l: false, r: false },
    };
    stateRef.current = state;

    const onKey = (e) => {
      if (["ArrowLeft", "a"].includes(e.key)) state.keys.l = e.type === "keydown";
      if (["ArrowRight", "d"].includes(e.key)) state.keys.r = e.type === "keydown";
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    let raf;
    const tick = () => {
      const s = stateRef.current;
      if (!s.dead) {
        if (s.keys.l) s.paddle.x -= 6;
        if (s.keys.r) s.paddle.x += 6;
        s.paddle.x = Math.max(8, Math.min(W - s.paddle.w - 8, s.paddle.x));
        s.ball.x += s.ball.vx;
        s.ball.y += s.ball.vy;
        if (s.ball.x < 8 || s.ball.x > W - 8) s.ball.vx *= -1;
        if (s.ball.y < 8) s.ball.vy *= -1;
        if (
          s.ball.y >= H - 28 &&
          s.ball.x >= s.paddle.x &&
          s.ball.x <= s.paddle.x + s.paddle.w &&
          s.ball.vy > 0
        ) {
          const t = (s.ball.x - s.paddle.x) / s.paddle.w - 0.5;
          s.ball.vy = -Math.abs(s.ball.vy);
          s.ball.vx = t * 7;
        }
        s.bricks.forEach((b) => {
          if (!b.live) return;
          if (
            s.ball.x > b.x &&
            s.ball.x < b.x + b.w &&
            s.ball.y > b.y &&
            s.ball.y < b.y + b.h
          ) {
            b.live = false;
            s.ball.vy *= -1;
            s.score += 50 * s.stage;
          }
        });
        if (s.bricks.every((b) => !b.live)) {
          s.stage += 1;
          s.bricks = makeBricks(s.stage);
          s.ball = { x: W / 2, y: 240, vx: 3.2 + s.stage * 0.2, vy: -3.6 - s.stage * 0.15 };
        }
        if (s.ball.y > H) {
          s.dead = true;
          onOver({ stages: s.stage, score: s.score });
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
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [onOver]);

  return (
    <div className="cabinet-play">
      <div className="cabinet-hud">
        <span>BREAKER</span>
        <span>STAGE {hud.stage}</span>
        <span>{hud.score}</span>
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      <p className="hint">A · D or arrows · clear the wall to advance</p>
    </div>
  );
}

function draw(ctx, s) {
  ctx.fillStyle = "#04110c";
  ctx.fillRect(0, 0, W, H);
  s.bricks.forEach((b) => {
    if (!b.live) return;
    ctx.fillStyle = "#3ee07a";
    ctx.fillRect(b.x, b.y, b.w, b.h);
  });
  ctx.fillStyle = "#ffe27a";
  ctx.fillRect(s.paddle.x, H - 22, s.paddle.w, 8);
  ctx.fillStyle = "#f4fff4";
  ctx.beginPath();
  ctx.arc(s.ball.x, s.ball.y, 5, 0, Math.PI * 2);
  ctx.fill();
  if (s.dead) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ff6b6b";
    ctx.font = "14px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", W / 2, H / 2);
  }
}
