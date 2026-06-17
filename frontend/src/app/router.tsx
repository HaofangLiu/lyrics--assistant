import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { AppShell } from '../components/AppShell'
import { HomeRoute } from '../routes/HomeRoute'
import { SettingsRoute } from '../routes/SettingsRoute'
import { SongRoute } from '../routes/SongRoute'

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
})

const songRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/song/$songId',
  component: SongRoute,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsRoute,
})

const routeTree = rootRoute.addChildren([indexRoute, songRoute, settingsRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
