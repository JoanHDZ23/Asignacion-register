import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../components'
import { getDefaultAllowedModules } from '../lib/access'
import { clearCurrentUser, getCurrentToken, getCurrentUser } from '../lib/auth-storage'
import { apiRequest, type CompanyManagementResponse, type CompanyResponse } from '../lib/api'

type NavigationItem = {
  to: string
  label: string
  end?: boolean
  icon: 'icon-home' | 'icon-calendar' | 'icon-clipboard'
}

type NavigationGroup = {
  title: string
  items: NavigationItem[]
}

export function DashboardLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = getCurrentUser()
  const token = getCurrentToken()
  const isAdmin = user?.role === 'admin'
  const isSupervisor = user?.role === 'supervisor'
  const canUseManagement = isAdmin || isSupervisor
  const allowedModules = user?.allowedModules?.length
    ? user.allowedModules
    : getDefaultAllowedModules(user?.role ?? 'operativo')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [companyName, setCompanyName] = useState('')

  const navigationGroups = useMemo(
    () =>
      ([
        {
          title: 'General',
          items: allowedModules.includes('dashboard')
            ? [{ to: '/dashboard', label: 'Inicio', end: true, icon: 'icon-home' }]
            : [],
        },
        {
          title: 'Operacion',
          items: [
            ...(allowedModules.includes('asignacion-turnos')
              ? [{ to: '/dashboard/asignacion-turnos', label: 'Asignacion de turnos', icon: 'icon-calendar' }]
              : []),
            ...(isAdmin || isSupervisor || allowedModules.includes('gestion-asistencia')
              ? [{ to: '/dashboard/gestion-asistencia', label: 'Gestion de asistencia', icon: 'icon-clipboard' }]
              : []),
          ],
        },
      ] as NavigationGroup[]).filter((group) => group.items.length),
    [allowedModules, isAdmin],
  )

  const navigationItems = useMemo(
    () => navigationGroups.flatMap((group) => group.items),
    [navigationGroups],
  )

  const handleLogout = () => {
    clearCurrentUser()
    navigate('/login', { replace: true })
  }

  // Redirige al login automáticamente cuando cualquier llamada API devuelve 401
  useEffect(() => {
    const onSessionExpired = () => {
      clearCurrentUser()
      navigate('/login', { replace: true })
    }
    window.addEventListener('ommex:session-expired', onSessionExpired)
    return () => window.removeEventListener('ommex:session-expired', onSessionExpired)
  }, [navigate])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return
    navigate(`/dashboard/gestion-asistencia?q=${encodeURIComponent(searchQuery.trim())}`)
  }

  const handleNavigate = () => {
    setIsSidebarOpen(false)
  }

  const initials = useMemo(() => {
    const source = user?.nombreCompleto?.trim()
    if (!source) return 'OM'
    return source
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('')
  }, [user?.nombreCompleto])

  const currentDateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('es-CO', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date()),
    [],
  )

  const companyLabel = companyName || 'Empresa vinculada'
  const companyBadge = useMemo(() => {
    const source = companyName || user?.companyId || 'OM'
    return source
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 2)
  }, [companyName, user?.companyId])

  // Guard redirect
  useEffect(() => {
    const currentPath = location.pathname
    const firstAllowedPath = navigationItems[0]?.to ?? '/dashboard'

    if (currentPath === '/dashboard' && allowedModules.includes('dashboard')) return
    if (currentPath.includes('/dashboard/asignacion-turnos') && allowedModules.includes('asignacion-turnos')) return
    if (currentPath.includes('/dashboard/gestion-asistencia') && (isAdmin || isSupervisor || allowedModules.includes('gestion-asistencia'))) return

    navigate(firstAllowedPath, { replace: true })
  }, [allowedModules, isAdmin, location.pathname, navigate, navigationItems])

  // Load company name
  useEffect(() => {
    if (!token) return

    const loadCompany = async () => {
      try {
        if (canUseManagement) {
          const result = await apiRequest<CompanyManagementResponse>('/companies/management', { token })
          setCompanyName(result.company?.nombre ?? '')
          return
        }
        const company = await apiRequest<CompanyResponse>('/companies/me', { token })
        setCompanyName(company.nombre)
      } catch {
        setCompanyName('')
      }
    }

    void loadCompany()
  }, [canUseManagement, token])

  return (
    <main className="app-layout">
      {/* Overlay for mobile sidebar */}
      <button
        aria-hidden={!isSidebarOpen}
        className={`sidebar-overlay${isSidebarOpen ? ' sidebar-overlay--visible' : ''}`}
        type="button"
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`sidebar${isSidebarOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo__icon">O</div>
          <div className="sidebar-logo__text">
            <span className="sidebar-logo__title">Ommex</span>
            <span className="sidebar-logo__sub">Panel empresas</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navigationGroups.map((group) => (
            <div className="sidebar-nav__group" key={group.title}>
              <span className="sidebar-nav__label">{group.title}</span>
              <ul className="sidebar-nav__list" aria-label={group.title}>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `sidebar-nav__link${isActive ? ' sidebar-nav__link--active' : ''}`
                      }
                      onClick={handleNavigate}
                    >
                      <Icon name={item.icon} size={18} />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-profile">
            <div className="sidebar-profile__company">
              <div className="profile-badge profile-badge--blue">{companyBadge}</div>
              <div className="profile-meta">
                <span className="profile-meta__name">{companyLabel}</span>
                <span className="profile-meta__sub">{user?.cargo ?? (isAdmin ? 'Administrador' : isSupervisor ? 'Supervisor' : 'Operativo')}</span>
              </div>
            </div>
            <div className="sidebar-profile__user">
              <div className="profile-badge profile-badge--purple">{initials}</div>
              <div className="profile-meta">
                <span className="profile-meta__name">{user?.nombreCompleto ?? 'Usuario'}</span>
                <span className="profile-meta__sub">{user?.correo ?? ''}</span>
              </div>
            </div>
          </div>

          <button className="sidebar-logout" type="button" onClick={handleLogout}>
            <Icon name="icon-logout" size={16} />
            <span>Cerrar sesion</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="main-area">
        {/* Desktop header */}
        <header className="top-bar">
          <form className="top-bar__search" onSubmit={handleSearchSubmit}>
            <Icon name="icon-search" size={16} />
            <input
              type="search"
              placeholder="Buscar empleado, turno o responsable…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Buscar"
            />
          </form>

          <div className="top-bar__right">
            <span className="top-bar__date">{currentDateLabel}</span>
            <div className="top-bar__avatar" aria-hidden="true">{initials}</div>
          </div>
        </header>

        {/* Mobile header */}
        <header className="mobile-bar">
          <button
            className="mobile-bar__menu"
            type="button"
            aria-label="Abrir menu"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Icon name="icon-menu" size={20} />
          </button>
          <span className="mobile-bar__title">Ommex Turnos</span>
          <div className="mobile-bar__avatar" aria-hidden="true">{initials}</div>
        </header>

        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </main>
  )
}
