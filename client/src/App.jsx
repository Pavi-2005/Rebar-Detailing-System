import { Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import SlabDesignPage from './pages/SlabDesignPage';
import BeamDesignPage from './pages/BeamDesignPage';
import ColumnDesignPage from './pages/ColumnDesignPage';
import FootingDesignPage from './pages/FootingDesignPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import HistoryPage from './pages/HistoryPage';
import CalculationStepsPage from './pages/CalculationStepsPage';
import RequireAuth from './components/RequireAuth';

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/slab" element={<RequireAuth><SlabDesignPage /></RequireAuth>} />
      <Route path="/beam" element={<RequireAuth><BeamDesignPage /></RequireAuth>} />
      <Route path="/column" element={<RequireAuth><ColumnDesignPage /></RequireAuth>} />
      <Route path="/footing" element={<RequireAuth><FootingDesignPage /></RequireAuth>} />
      <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
      <Route path="/steps" element={<RequireAuth><CalculationStepsPage /></RequireAuth>} />
    </Routes>
  );
}

export default App;
