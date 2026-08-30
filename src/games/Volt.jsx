import { useEffect, useRef, useState } from "react";

const CELL = 16;
const COLS = 24;
const ROWS = 20;

function randEmpty(snake) {
  const taken = new Set(snake.map((p) => `${p.x},${p.y}`));
  let x, y;
  do {
    x = Math.floor(Math.random() * COLS);
    y = Math.floor(Math.random() * ROWS);
  } while (taken.has(`${x},${y}`));
  return { x, y };
}

export default function Volt({ onOver }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const [hud, setHud] = useState({ score: 0, stage: 1, live: true });

  useEffect(() => {
    const snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    const state = {
      snake,
      dir: { x: 1, y: 0 },
      next: { x: 1, y: 0 },
      food: randEmpty(snake),
      score: 0,
      stage: 1,
      eaten: 0,
      dead: false,
      acc: 0,
    };
    stateRef.current = state;

    const onKey = (e) => {
      const map = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        w: { x: 0, y: -1 },
        s: { x: 0, y: 1 },
        a: { x: -1, y: 0 },
        d: { x: 1, y: 0 },
      };
      const next = map[e.key];
      if (!next) return;
      e.preventDefault();
      const cur = state.dir;
      if (next.x === -cur.x && next.y === -cur.y) return;
      state.next = next;
    };
    window.addEventListener("keydown", onKey);

    let last = performance.now();
    let raf;
    const tick = (now) => {
      const s = stateRef.current;
      const dt = now - last;
      last = now;
      if (!s.dead) {
        s.acc += dt;
        const step = Math.max(90, 160 - s.stage * 8);
        if (s.acc >= step) {
          s.acc = 0;
          s.dir = s.next;
          const head = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };
          const hitWall = head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS;
          const hitSelf = s.snake.some((p) => p.x === head.x && p.y === head.y);
          if (hitWall || hitSelf) {
            s.dead = true;
            setHud({ score: s.score, stage: s.stage, live: false });
            onOver({ stages: s.stage, score: s.score });
          } else {
            s.snake.unshift(head);
            if (head.x === s.food.x && head.y === s.food.y) {
              s.score += 100 * s.stage;
              s.eaten += 1;
              if (s.eaten % 5 === 0) s.stage += 1;
              s.food = randEmpty(s.snake);
            } else {
              s.snake.pop();
            }
            setHud({ score: s.score, stage: s.stage, live: true });
          }
        }
      }
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) draw(ctx, s);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, [onOver]);

  return (
    <div className="cabinet-play">
      <div className="cabinet-hud">
        <span>VOLT</span>
        <span>STAGE {hud.stage}</span>
        <span>{hud.score}</span>
      </div>
      <canvas ref={canvasRef} width={COLS * CELL} height={ROWS * CELL} />
      <p className="hint">WASD or arrows · five orbs clear a stage</p>
    </div>
  );
}

function draw(ctx, s) {
  ctx.fillStyle = "#04110c";
  ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
  ctx.strokeStyle = "rgba(80, 255, 160, 0.08)";
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL, 0);
    ctx.lineTo(x * CELL, ROWS * CELL);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffe27a";
  ctx.fillRect(s.food.x * CELL + 3, s.food.y * CELL + 3, CELL - 6, CELL - 6);
  s.snake.forEach((p, i) => {
    ctx.fillStyle = i === 0 ? "#5cff9a" : "#1f9a58";
    ctx.fillRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2);
  });
  if (s.dead) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
    ctx.fillStyle = "#ff6b6b";
    ctx.font = "14px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", (COLS * CELL) / 2, (ROWS * CELL) / 2);
  }
}
