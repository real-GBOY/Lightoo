import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Page-level gate: signed-out visitors go to /login before any app code ships to them.
// API routes enforce auth themselves (requireOwner), so this only guards navigations.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get('lightoo_session')?.value;
  const secret = process.env.SESSION_SECRET;
  let ok = false;
  if (token && secret) {
    try { await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] }); ok = true; } catch { /* invalid or expired */ }
  }
  const { pathname } = req.nextUrl;
  if (!ok && pathname !== '/login') return NextResponse.redirect(new URL('/login', req.url));
  if (ok && pathname === '/login') return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}

export const config = {
  // Everything except API, Next internals, and the PWA/static files that must load signed-out.
  matcher: ['/((?!api|_next|icons|sw\.js|offline\.html|manifest\.webmanifest|favicon\.ico).*)'],
};
