import { render } from 'preact';
import { App } from './ui/App';
import './styles.css';
import './ui/acoustics.css';
import { startSimScheduling } from './acoustics/schedule';

render(<App />, document.getElementById('app')!);
startSimScheduling();
