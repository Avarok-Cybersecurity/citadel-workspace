import { createRoot } from 'react-dom/client';
import '@/index.css';
import '@/styles/brand-tokens.css';
import { SCENARIOS } from './scenarios.jsx';

const params = new URLSearchParams(location.search);
const wantsDark = params.has('theme') ? params.get('theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
if (wantsDark) document.documentElement.classList.add('dark');
// The app's Lite motion tier, as applyMotionPreference sets it (lib/motion-state.ts).
if (params.get('motion') === 'lite') document.documentElement.classList.add('lite-motion');
// The page with no scenario lists them, for checks that measure every one (checks-dialog-footers).
window.harnessScenarios = Object.keys(SCENARIOS);
if (params.has('s')) {
  const Scenario = SCENARIOS[params.get('s')];
  if (!Scenario) throw new Error(`no scenario named ${params.get('s')}`);
  createRoot(document.getElementById('root')).render(<Scenario />);
}
