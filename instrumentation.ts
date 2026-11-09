// Hook bawaan Next.js: register() dijalankan sekali saat server dimulai; onRequestError menangkap galat
// tak tertangani (render server component, route handler yang melempar) agar sampai ke log terstruktur dan Sentry.
import { logger } from './lib/utils/logger';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initMonitoring } = await import('./lib/server/monitoring');
    initMonitoring();
  }
}

export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routeType?: string; routePath?: string; routerKind?: string }
) {
  logger.error('request.unhandled', {
    err,
    method: request?.method,
    // routePath = pola rute (mis. /api/students/create), bukan URL lengkap dengan id/query.
    route: context?.routePath ?? request?.path?.split('?')[0],
    routeType: context?.routeType,
    routerKind: context?.routerKind,
  });
}
