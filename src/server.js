import express from 'express';
import taskRoutes from './routes/tasks.js';

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/tasks', taskRoutes);

export default app;
