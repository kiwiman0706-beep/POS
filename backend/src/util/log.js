const pad = (n) => String(n).padStart(2, '0');

function ts() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmt(level, scope, args) {
  return [`[${ts()}] ${level} (${scope})`, ...args];
}

export function makeLogger(scope) {
  return {
    info: (...a) => console.log(...fmt('INFO ', scope, a)),
    warn: (...a) => console.warn(...fmt('WARN ', scope, a)),
    error: (...a) => console.error(...fmt('ERROR', scope, a)),
    debug: (...a) => {
      if (process.env.DEBUG) console.log(...fmt('DEBUG', scope, a));
    },
  };
}
