import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Icon } from '../components'
import {
  apiRequest,
  type CompanyManagementResponse,
  type CompanyResponse,
  type TurnResponse,
} from '../lib/api'
import { getDefaultAllowedModules } from '../lib/access'
import { getCurrentToken, getCurrentUser } from '../lib/auth-storage'

export default function DashboardHomePage() {
  const [company, setCompany] = useState<CompanyResponse | null>(null)
  const [management, setManagement] = useState<CompanyManagementResponse | null>(null)
  const [turns, setTurns] = useState<TurnResponse[]>([])
  const [selectedPointId, setSelectedPointId] = useState<string>('')
  const currentUser = getCurrentUser()
  const isAdmin = currentUser?.role === 'admin'
  const allowedModules = currentUser?.allowedModules?.length
    ? currentUser.allowedModules
    : getDefaultAllowedModules(currentUser?.role ?? 'operativo')

  // Permisos derivados — funciona para empresa Y academia
  const hasGestion = isAdmin || allowedModules.some((m) =>
    ['geolocalizacion', 'porcentaje-asistencia', 'facturacion', 'asistencia-docente', 'alertas-inasistencia'].includes(m)
  )
  const hasAsignacion = allowedModules.some((m) =>
    ['turnos-fijos', 'turnos-rotativos', 'asistencia-clase', 'codigo-qr', 'asistencia-docente'].includes(m)
  )

  useEffect(() => {
    const token = getCurrentToken()

    if (!token) {
      return
    }

    if (isAdmin) {
      void apiRequest<CompanyManagementResponse>('/companies/management', { token }).then((result) => {
        setCompany(result.company)
        setManagement(result)
        setTurns(result.turns)
      })
      return
    }

    void Promise.allSettled([
      apiRequest<CompanyResponse>('/companies/me', { token }),
      apiRequest<TurnResponse[]>('/turns', { token }),
    ]).then((results) => {
      const [companyResult, turnsResult] = results

      if (companyResult.status === 'fulfilled') {
        setCompany(companyResult.value)
      }

      if (turnsResult.status === 'fulfilled') {
        setTurns(turnsResult.value)
      }
    })
  }, [isAdmin])

  const dashboardMetrics = useMemo(() => {
    const activeEmployees = management?.users.filter((user) => user.activa).length ?? 0
    const today = new Date().toISOString().slice(0, 10)
    const todayTurns = turns.filter((t) => t.fecha === today)
    const onTimeEntries = todayTurns.filter((turn) => turn.estado === 'finalizado' || turn.attendance?.checkIn).length
    const pendingVerification = todayTurns.filter((turn) => turn.estado === 'pendiente' || turn.estado === 'asignado').length
    const assignedToday = todayTurns.length

    const all = [
      hasGestion ? {
        title: 'Empleados activos',
        value: activeEmployees,
        description: `Empresa: ${company?.nombre ?? 'Sin empresa activa'}`,
        accent: 'violet',
      } : null,
      hasGestion ? {
        title: 'Entradas verificadas hoy',
        value: onTimeEntries,
        description: onTimeEntries ? 'Registro operativo al dia' : 'Pendiente de validacion',
        accent: 'green',
      } : null,
      hasAsignacion ? {
        title: 'Turnos por iniciar hoy',
        value: pendingVerification,
        description: pendingVerification ? 'Revisar asignaciones pendientes' : 'Sin alertas inmediatas',
        accent: 'amber',
      } : null,
      hasAsignacion ? {
        title: 'Turnos asignados hoy',
        value: assignedToday,
        description: `${turns.length} en total historial`,
        accent: 'blue',
      } : null,
    ]
    return all.filter(Boolean) as { title: string; value: number; description: string; accent: string }[]
  }, [company?.nombre, management?.users, turns, hasGestion, hasAsignacion])

  const quickAccessItems = useMemo(
    () => {
      // Detecta si es academia por los módulos (sin necesitar la empresa)
      const isAcademia = allowedModules.some((m) => ['asistencia-clase', 'codigo-qr', 'asistencia-docente'].includes(m))

      return [
        hasAsignacion
          ? {
              to: '/dashboard/asignacion-turnos',
              title: isAcademia ? 'Asistencia de clases' : 'Asignacion de turnos',
              description: isAcademia ? 'Gestiona la asistencia por clase y horario.' : 'Consulta turnos por fecha, estado y responsable.',
              accent: 'violet' as const,
            }
          : null,
        hasGestion
          ? {
              to: '/dashboard/gestion-asistencia',
              title: isAcademia ? 'Control académico' : 'Gestion de asistencia',
              description: isAcademia ? 'Porcentaje de faltas, justificaciones y alertas.' : 'Registra y verifica entradas y salidas.',
              accent: 'green' as const,
            }
          : null,
      ].filter(
        (item): item is { to: string; title: string; description: string; accent: 'violet' | 'green' } =>
          Boolean(item),
      )
    },
    [hasAsignacion, hasGestion, allowedModules],
  )

  const upcomingTurns = useMemo(() => {
    return [...turns]
      .filter((turn) => turn.estado === 'pendiente' || turn.estado === 'asignado')
      .sort((a, b) => {
        const firstDate = new Date(`${a.fecha}T${a.hora || '00:00'}`).getTime()
        const secondDate = new Date(`${b.fecha}T${b.hora || '00:00'}`).getTime()

        if (Number.isNaN(firstDate) || Number.isNaN(secondDate)) {
          return `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`)
        }

        return firstDate - secondDate
      })
      .slice(0, 5)
      .map((turn) => ({
        id: turn.id,
        responsable: turn.assignedToUserName || 'Personal pendiente',
        titulo: turn.titulo,
        ubicacion: turn.locationNombre || 'Ubicacion pendiente',
        horario: `${turn.fecha} · ${turn.hora}${turn.horaFin ? ` - ${turn.horaFin}` : ''}`,
        accent: turn.estado === 'pendiente' ? 'amber' : 'violet',
        estado: turn.estado.replace('_', ' '),
      }))
  }, [turns])

  const assignmentsByPoint = useMemo(() => {
    const groupedPoints = new Map<
      string,
      {
        id: string
        nombre: string
        totalTurnos: number
        activos: number
        pendientes: number
        fecha: string
        personal: Array<{
          id: string
          nombre: string
          turno: string
          horario: string
          estado: TurnResponse['estado']
        }>
      }
    >()

    turns.forEach((turn) => {
      const pointId = turn.locationId || turn.locationNombre || 'sin-ubicacion'
      const pointName = turn.locationNombre || 'Punto por definir'
      const currentPoint = groupedPoints.get(pointId) ?? {
        id: pointId,
        nombre: pointName,
        totalTurnos: 0,
        activos: 0,
        pendientes: 0,
        fecha: turn.fecha,
        personal: [],
      }

      currentPoint.totalTurnos += 1
      currentPoint.fecha = turn.fecha > currentPoint.fecha ? turn.fecha : currentPoint.fecha

      if (turn.estado === 'en_proceso' || turn.estado === 'finalizado') {
        currentPoint.activos += 1
      }

      if (turn.estado === 'pendiente' || turn.estado === 'asignado') {
        currentPoint.pendientes += 1
      }

      currentPoint.personal.push({
        id: turn.id,
        nombre: turn.assignedToUserName || 'Personal pendiente',
        turno: turn.titulo,
        horario: `${turn.hora}${turn.horaFin ? ` - ${turn.horaFin}` : ''}`,
        estado: turn.estado,
      })

      groupedPoints.set(pointId, currentPoint)
    })

    return [...groupedPoints.values()].sort((a, b) => {
      if (b.totalTurnos !== a.totalTurnos) {
        return b.totalTurnos - a.totalTurnos
      }

      return a.nombre.localeCompare(b.nombre)
    })
  }, [turns])

  // Deriva el punto seleccionado sin useEffect — evita cascada de renders
  const defaultPointId = assignmentsByPoint[0]?.id ?? ''
  const resolvedPointId = selectedPointId && assignmentsByPoint.some((p) => p.id === selectedPointId)
    ? selectedPointId
    : defaultPointId

  const selectedPoint = assignmentsByPoint.find((point) => point.id === resolvedPointId) ?? null

  const dashboardSignals = useMemo(
    () => [
      hasAsignacion ? { label: 'Puntos activos',  value: assignmentsByPoint.length } : null,
      hasAsignacion ? { label: 'Turnos hoy',      value: turns.length } : null,
      hasGestion    ? { label: 'Equipo operativo', value: management?.users.filter((u) => u.role === 'operativo').length ?? 0 } : null,
    ].filter(Boolean) as { label: string; value: number }[],
    [assignmentsByPoint.length, management?.users, turns.length, hasAsignacion, hasGestion],
  )

  useEffect(() => {
    if (resolvedPointId && resolvedPointId !== selectedPointId) {
      setSelectedPointId(resolvedPointId)
    }
  }, [resolvedPointId, selectedPointId])

  return (
    <div className="dashboard-page">
      <section className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-subtitle">Resumen de asistencia y asignacion de turnos de tu empresa.</p>
        </div>

        {allowedModules.includes('turnos-fijos') ? (
          <Link to="/dashboard/asignacion-turnos" className="dashboard-page__cta">
            <Button icon="icon-calendar" className="btn-primary">
              Ver asignacion
            </Button>
          </Link>
        ) : null}
      </section>

      {/* Stats — solo las métricas permitidas según módulos */}
      {dashboardMetrics.length > 0 ? (
        <section className="stats-grid">
          {dashboardMetrics.map((metric) => (
            <article className="stat-card" key={metric.title}>
              <div className={`stat-icon stat-icon--${metric.accent}`}>
                <Icon name="icon-bar-chart" size={18} />
              </div>
              <div className="stat-content">
                <div className="stat-value">{metric.value}</div>
                <div className="stat-label">{metric.title}</div>
                <div className="stat-meta">{metric.description}</div>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {/* Accesos rápidos + turnos próximos — solo si tiene algún módulo */}
      {quickAccessItems.length > 0 || hasAsignacion ? (
        <section className="content-grid">
          {quickAccessItems.length > 0 ? (
            <article className="content-card">
              <h3>Accesos rapidos</h3>
              <div className="quick-link-list">
                {quickAccessItems.map((item) => (
                  <Link className="quick-link" key={item.to} to={item.to}>
                    <div className={`quick-link-icon quick-link-icon--${item.accent}`}>
                      <Icon name="icon-bar-chart" size={18} />
                    </div>
                    <div className="quick-link-content">
                      <div className="quick-link-title">{item.title}</div>
                      <div className="quick-link-desc">{item.description}</div>
                    </div>
                    <span className="quick-link-arrow">→</span>
                  </Link>
                ))}
              </div>
            </article>
          ) : null}

          {hasAsignacion ? (
            <article className="content-card">
              <h3>5 turnos por iniciar</h3>
              <p className="text-secondary">Vista rapida de los proximos turnos operativos programados.</p>
              <div className="turn-preview-list">
                {upcomingTurns.length ? (
                  upcomingTurns.map((turn) => (
                    <article className="turn-preview-item" key={turn.id}>
                      <div className={`turn-preview-icon turn-preview-icon--${turn.accent}`}>
                        <Icon name="icon-bar-chart" size={16} />
                      </div>
                      <div className="turn-preview-body">
                        <div className="turn-preview-title">{turn.responsable}</div>
                        <div className="turn-preview-meta">{`${turn.titulo} · ${turn.ubicacion}`}</div>
                        <div className="turn-preview-meta">{`${turn.horario} · Estado: ${turn.estado}`}</div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <div className="empty-state-title">Sin turnos proximos</div>
                    <div className="empty-state-desc">No hay turnos pendientes o asignados para mostrar.</div>
                  </div>
                )}
              </div>
            </article>
          ) : null}
        </section>
      ) : null}

      {/* Signal strip — solo si tiene módulos con datos */}
      {dashboardSignals.length > 0 ? (
        <section className="dashboard-signal-strip">
          {dashboardSignals.map((signal) => (
            <article className="signal-chip" key={signal.label}>
              <strong>{signal.value}</strong>
              <span>{signal.label}</span>
            </article>
          ))}
        </section>
      ) : null}

      {/* Asignaciones por punto — solo si tiene asignacion-turnos */}
      {hasAsignacion ? (
      <section className="dashboard-grid">
        <article className="content-panel">
          <header className="content-panel__header">
            <div>
              <h2>Asignaciones por punto</h2>
              <p>Selecciona un punto de trabajo para ver el personal programado.</p>
            </div>
          </header>

          {assignmentsByPoint.length ? (
            <div className="assignment-board">
              <div className="assignment-board__table">
                <table>
                  <thead>
                    <tr>
                      <th>Punto</th>
                      <th>Fecha</th>
                      <th>Turnos</th>
                      <th>Activos</th>
                      <th>Pendientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignmentsByPoint.map((point) => {
                      const isSelected = selectedPoint?.id === point.id

                      return (
                        <tr
                          key={point.id}
                          className={isSelected ? 'assignment-board__row assignment-board__row--active' : 'assignment-board__row'}
                          onClick={() => setSelectedPointId(point.id)}
                        >
                          <td>
                            <button className="assignment-board__point" type="button">
                              <strong>{point.nombre}</strong>
                              <span>{point.personal.length} personas asignadas</span>
                            </button>
                          </td>
                          <td>{point.fecha}</td>
                          <td>{point.totalTurnos}</td>
                          <td>{point.activos}</td>
                          <td>{point.pendientes}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <article className="activity-item activity-item--empty">
              <div className="activity-item__body">
                <strong>Sin puntos con asignaciones</strong>
                <span>Cuando registres turnos con ubicacion, se mostraran aqui agrupados por punto.</span>
              </div>
            </article>
          )}
        </article>

        <article className="content-panel">
          <header className="content-panel__header">
            <div>
              <h2>{selectedPoint?.nombre ?? 'Personal asignado'}</h2>
              <p>
                {selectedPoint
                  ? `Personal programado para ${selectedPoint.fecha}.`
                  : 'Selecciona un punto de trabajo para ver el detalle.'}
              </p>
            </div>
          </header>

          {selectedPoint ? (
            <div className="detail-chip-row">
              <span className="detail-chip">
                <strong>{selectedPoint.totalTurnos}</strong>
                Turnos
              </span>
              <span className="detail-chip">
                <strong>{selectedPoint.activos}</strong>
                Activos
              </span>
              <span className="detail-chip">
                <strong>{selectedPoint.pendientes}</strong>
                Pendientes
              </span>
            </div>
          ) : null}

          <div className="point-staff-list">
            {selectedPoint ? (
              selectedPoint.personal.map((person) => (
                <article className="point-staff-card" key={person.id}>
                  <div className="point-staff-card__avatar">{person.nombre.slice(0, 2).toUpperCase()}</div>
                  <div className="point-staff-card__meta">
                    <strong>{person.nombre}</strong>
                    <span>{person.turno}</span>
                    <span>{person.horario}</span>
                  </div>
                  <span className={`turn-status turn-status--${person.estado}`}>{person.estado.replace('_', ' ')}</span>
                </article>
              ))
            ) : (
              <article className="activity-item activity-item--empty">
                <div className="activity-item__body">
                  <strong>Sin personal seleccionado</strong>
                  <span>Haz clic en un punto de la tabla para ver el equipo asignado.</span>
                </div>
              </article>
            )}
          </div>
        </article>
      </section>
      ) : null}
    </div>
  )
}
