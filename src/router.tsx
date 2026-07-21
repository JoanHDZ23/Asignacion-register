import { Navigate, createBrowserRouter } from 'react-router-dom'
import { AuthLayout } from './layouts/AuthLayout'
import { DashboardLayout } from './layouts/DashboardLayout'
import { RequireAuth } from './layouts/RequireAuth'
import AttendanceAdminPage from './pages/AttendanceAdminPage'
import DashboardHomePage from './pages/DashboardHomePage'
import LoginPage from './pages/LoginPage'
import MemberInvitationPage from './pages/MemberInvitationPage'
import RegisterPage from './pages/RegisterPage'
import TurnAssignmentsPage from './pages/TurnAssignmentsPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate replace to="/login" />,
  },
  {
    element: <AuthLayout />,
    children: [
      {
        path: '/login',
        element: <LoginPage />,
      },
      {
        path: '/register',
        element: <RegisterPage />,
      },
      {
        path: '/registro-integrante/:token',
        element: <MemberInvitationPage />,
      },
    ],
  },
  {
    path: '/dashboard',
    element: (
      <RequireAuth>
        <DashboardLayout />
      </RequireAuth>
    ),
    children: [
      {
        index: true,
        element: <DashboardHomePage />,
      },
      {
        path: 'asignacion-turnos',
        element: <TurnAssignmentsPage />,
      },
      {
        path: 'gestion-asistencia',
        element: <AttendanceAdminPage />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate replace to="/login" />,
  },
])
