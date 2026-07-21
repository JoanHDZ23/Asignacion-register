import { NavLink, Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <main className="auth-layout">
      <section className="auth-layout__hero">
        <span className="auth-layout__eyebrow">Ommex Register</span>
        <h1>Gestiona ingresos y registros del personal</h1>
        <p>
          Usa el formulario de acceso para ingresar con el documento o registra
          nuevos usuarios con sus datos basicos.
        </p>

        <div className="auth-layout__tips">
          <article>
            <strong>Ingreso rapido</strong>
            <span>Valida usuarios por tipo y numero de documento.</span>
          </article>
          <article>
            <strong>Registro simple</strong>
            <span>Guarda nombre completo, documento y cargo del usuario.</span>
          </article>
        </div>
      </section>

      <section className="auth-layout__panel">
        <nav className="auth-tabs" aria-label="Navegacion de autenticacion">
          <NavLink
            to="/login"
            className={({ isActive }) =>
              isActive ? 'auth-tabs__link auth-tabs__link--active' : 'auth-tabs__link'
            }
          >
            Ingresar
          </NavLink>
        </nav>

        <Outlet />
      </section>
    </main>
  )
}
