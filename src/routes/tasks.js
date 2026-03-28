import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Hardcoded array of 2 tasks (id, title, type)
const tasks = [
  { id: '1', title: 'Implement login', type: 'feature' },
  { id: '2', title: 'Fix bug in auth', type: 'bug' }
];

// GET / returns a hardcoded array of 2 tasks
router.get('/', (req, res) => {
  res.json(tasks);
});

// POST / validates 'title' and 'type' are present (returns 400 if missing)
// generates a unique id using the 'uuid' package, and returns the created task
router.post('/', (req, res) => {
  const { title, type } = req.body;

  if (!title || !type) {
    return res.status(400).json({ error: 'title and type are required' });
  }

  const newTask = {
    id: uuidv4(),
    title,
    type
  };

  res.status(201).json(newTask);
});

export default router;
