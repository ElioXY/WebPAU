/* =========================================================================
   Cronómetro del modo práctica.

   Cuenta hacia atrás con la hora del reloj, no con un contador de ticks: si la
   pestaña se queda en segundo plano, al volver el tiempo sigue siendo el real.
   El estado se guarda en sessionStorage para que refrescar no lo reinicie.
   ========================================================================= */

interface PracticeData {
  key: string;
  minutes: number;
}

interface Saved {
  minutes: number;
  /** Milisegundos que quedaban al pausar o al cargar (si no corre). */
  remaining: number;
  /** Momento en que termina, si corre. */
  endsAt: number | null;
  running: boolean;
  done: boolean;
}

const dataEl = document.getElementById('practice-data');
if (dataEl?.textContent) {
  const data = JSON.parse(dataEl.textContent) as PracticeData;
  setup(data);
}

function setup(data: PracticeData): void {
  const clock = document.getElementById('clock');
  const clockState = document.getElementById('clockState');
  const duration = document.getElementById('duration') as HTMLSelectElement | null;
  const startBtn = document.getElementById('btnStart');
  const pauseBtn = document.getElementById('btnPause');
  const finishBtn = document.getElementById('btnFinish');
  const resetBtn = document.getElementById('btnReset');
  const correccion = document.getElementById('correccion');
  const intro = document.getElementById('correccionIntro');

  if (!clock || !clockState || !duration || !startBtn || !pauseBtn || !finishBtn || !resetBtn) {
    return;
  }

  const STORE = `practice:${data.key}`;
  const total = (state: Saved) => Math.round(state.minutes * 60_000);

  const initial = (): Saved => ({
    minutes: data.minutes,
    remaining: data.minutes * 60_000,
    endsAt: null,
    running: false,
    done: false,
  });

  const load = (): Saved => {
    try {
      const raw = sessionStorage.getItem(STORE);
      if (!raw) return initial();
      const saved = JSON.parse(raw) as Partial<Saved>;
      const minutes =
        typeof saved.minutes === 'number' && saved.minutes >= 1 && saved.minutes <= 600
          ? saved.minutes
          : data.minutes;
      return {
        minutes,
        remaining:
          typeof saved.remaining === 'number' && saved.remaining >= 0
            ? saved.remaining
            : minutes * 60_000,
        endsAt: typeof saved.endsAt === 'number' ? saved.endsAt : null,
        running: saved.running === true,
        done: saved.done === true,
      };
    } catch {
      return initial();
    }
  };

  let state = load();
  let timer: number | undefined;

  const liveRemaining = (): number =>
    state.running && state.endsAt !== null
      ? Math.max(0, state.endsAt - Date.now())
      : Math.max(0, state.remaining);

  const fmt = (ms: number): string => {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    const days = Math.floor(seconds / 86_400);
    const rest = seconds % 86_400;
    const hours = Math.floor(rest / 3600);
    const minutes = Math.floor((rest % 3600) / 60);
    const secs = rest % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return days > 0
      ? `${days} d ${pad(hours)}:${pad(minutes)}:${pad(secs)}`
      : `${pad(hours * 60 + minutes)}:${pad(secs)}`;
  };

  const save = (): void => {
    try {
      sessionStorage.setItem(
        STORE,
        JSON.stringify({ ...state, remaining: liveRemaining() } satisfies Saved)
      );
    } catch {
      /* almacenamiento no disponible */
    }
  };

  const reveal = (message: string): void => {
    if (!correccion) return;
    correccion.hidden = false;
    if (intro) intro.textContent = message;
  };

  const hideCorrection = (): void => {
    if (correccion) correccion.hidden = true;
  };

  const render = (): void => {
    const left = liveRemaining();
    const paused = !state.running && !state.done && left < total(state);
    clock.textContent = fmt(left);
    clock.dataset.state = state.done ? 'done' : state.running ? 'running' : paused ? 'paused' : 'idle';

    startBtn.hidden = state.running || paused;
    startBtn.textContent = state.done ? 'Empezar de nuevo' : 'Empezar';
    pauseBtn.hidden = !state.running && !paused;
    pauseBtn.textContent = state.running ? 'Pausar' : 'Reanudar';
    finishBtn.hidden = !state.running && !paused;
    resetBtn.hidden = !state.running && !paused && !state.done;
    duration.disabled = state.running || paused || state.done;

    if (state.done) {
      clockState.textContent = 'Terminado. La corrección está abajo.';
    } else if (state.running) {
      clockState.textContent = 'En marcha. El tiempo corre aunque cambies de pestaña.';
    } else if (paused) {
      clockState.textContent = 'En pausa.';
    } else {
      clockState.textContent = 'Sin empezar. Elige la duración y pulsa «Empezar».';
    }
  };

  const stopTicking = (): void => {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };

  const tick = (): void => {
    if (!state.running) return;
    if (liveRemaining() <= 0) {
      finish(true);
      return;
    }
    clock.textContent = fmt(liveRemaining());
  };

  const startTicking = (): void => {
    stopTicking();
    timer = window.setInterval(tick, 250);
  };

  const start = (): void => {
    const minutes = Number(duration.value) || data.minutes;
    state = { minutes, remaining: minutes * 60_000, endsAt: Date.now() + minutes * 60_000, running: true, done: false };
    hideCorrection();
    save();
    render();
    startTicking();
  };

  const pause = (): void => {
    if (!state.running) {
      state.endsAt = Date.now() + state.remaining;
      state.running = true;
      save();
      render();
      startTicking();
      return;
    }
    state.remaining = liveRemaining();
    state.endsAt = null;
    state.running = false;
    stopTicking();
    save();
    render();
  };

  const finish = (outOfTime = false): void => {
    const left = liveRemaining();
    const used = total(state) - left;
    state.remaining = left;
    state.endsAt = null;
    state.running = false;
    state.done = true;
    stopTicking();
    save();
    render();
    reveal(
      outOfTime
        ? 'Se acabó el tiempo. Así se corrige este examen:'
        : `Has terminado en ${fmt(used)}. Comprueba tus respuestas:`
    );
    correccion?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    correccion?.focus?.({ preventScroll: true });
  };

  const reset = (): void => {
    stopTicking();
    state = initial();
    try {
      sessionStorage.removeItem(STORE);
    } catch {
      /* nada */
    }
    hideCorrection();
    render();
  };

  startBtn.addEventListener('click', start);
  pauseBtn.addEventListener('click', pause);
  finishBtn.addEventListener('click', () => finish(false));
  resetBtn.addEventListener('click', reset);

  duration.addEventListener('change', () => {
    if (state.running || state.done) return;
    const minutes = Number(duration.value) || data.minutes;
    state = { ...initial(), minutes, remaining: minutes * 60_000 };
    render();
  });

  /* Al volver a la pestaña el reloj real manda: si el tiempo se agotó mientras
     estaba oculta, se cierra al instante. */
  document.addEventListener('visibilitychange', () => {
    if (!state.running) return;
    if (liveRemaining() <= 0) {
      finish(true);
      return;
    }
    clock.textContent = fmt(liveRemaining());
    save();
  });

  window.addEventListener('pagehide', save);

  /* Estado recuperado: un cronómetro en marcha sigue corriendo y uno terminado
     ya enseña la corrección. */
  if (state.done) {
    reveal('Este examen ya está terminado. Aquí tienes la corrección:');
  } else if (state.running) {
    if ((state.endsAt ?? 0) - Date.now() <= 0) finish(true);
    else startTicking();
  }

  duration.value = String(state.minutes);
  render();
}
