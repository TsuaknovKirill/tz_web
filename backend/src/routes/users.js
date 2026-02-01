import express from 'express';

const router = express.Router();

/**
 * POST /api/users
 * Создать пользователя
 * body: { username, fullName?, email? }
 */
router.post('/', async (req, res) => {
  const prisma = req.prisma;
  const { username, fullName, email } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'username обязателен' });
  }

  try {
    const user = await prisma.user.create({
      data: {
        username,
        fullName,
        email,
      },
    });

    res.status(201).json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при создании пользователя' });
  }
});

/**
 * GET /api/users
 * Получить список пользователей
 */
router.get('/', async (req, res) => {
  const prisma = req.prisma;

  try {
    const users = await prisma.user.findMany({
      orderBy: { id: 'asc' },
    });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении пользователей' });
  }
});

export default router;
