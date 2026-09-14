import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import product from './product.json';
import './styles.css';

document.title = product.name;

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
