import { Link, useRouterState } from '@tanstack/react-router'
import { Home, Settings } from 'lucide-react'
import type { PropsWithChildren } from 'react'

export function AppShell({ children }: PropsWithChildren) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const isSongRoute = pathname.startsWith('/song/')

  return (
    <div className={isSongRoute ? 'app-shell song-mode' : 'app-shell'}>
      <main className="app-main">{children}</main>
      {isSongRoute ? null : (
        <nav className="bottom-nav" aria-label="主导航">
          <Link className={pathname === '/' ? 'nav-button active' : 'nav-button'} to="/">
            <Home size={24} aria-hidden="true" />
            <span>识曲</span>
          </Link>
          <Link
            className={pathname === '/settings' ? 'nav-button active' : 'nav-button'}
            to="/settings"
          >
            <Settings size={24} aria-hidden="true" />
            <span>设置</span>
          </Link>
        </nav>
      )}
    </div>
  )
}
