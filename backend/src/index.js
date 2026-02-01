import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

import usersRouter from './routes/users.js';
import specsRouter from './routes/specs.js';
import versionsRouter from './routes/versions.js';


dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Дадим prisma в req, чтобы использовать в роутерах
app.use((req, res, next) => {
  req.prisma = prisma;
  next();
});

app.use(cors());
app.use(express.json());

// Простая проверка, что сервер жив
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Подключаем маршруты
app.use('/api/users', usersRouter);
app.use('/api/specs', specsRouter);
app.use('/api/versions', versionsRouter);


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Backend запущен на http://localhost:${PORT}`);
});
