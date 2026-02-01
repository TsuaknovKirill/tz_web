import express from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

/**
 * POST /api/specs
 * Создать новое ТЗ с первой версией (draft)
 * body: { title, description?, createdById? }
 */
router.post('/', async (req, res) => {
  const prisma = req.prisma;
  const { title, description, createdById } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'title обязателен' });
  }

  try {
    // создаём Spec + первую версию в транзакции
    const result = await prisma.$transaction(async (tx) => {
      const spec = await tx.spec.create({
        data: {
          title,
          description,
          createdById: createdById || null,
        },
      });

      const version = await tx.specVersion.create({
        data: {
          specId: spec.id,
          versionNumber: 1,
          status: 'draft', // SpecVersionStatus
          createdById: createdById || null,
          comment: 'Первая версия',
        },
      });

      // Обновляем ссылку на текущую версию
      await tx.spec.update({
        where: { id: spec.id },
        data: { currentVersionId: version.id },
      });

      return { spec, version };
    });

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при создании ТЗ' });
  }
});

/**
 * GET /api/specs
 * Получить список ТЗ с текущей версией
 */
router.get('/', async (req, res) => {
  const prisma = req.prisma;

  try {
    const specs = await prisma.spec.findMany({
      include: {
        currentVersion: true,
      },
      orderBy: { id: 'asc' },
    });

    res.json(specs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении списка ТЗ' });
  }
});

/**
 * GET /api/specs/:id/versions
 * Получить список версий ТЗ
 */
router.get('/:id/versions', async (req, res) => {
  const prisma = req.prisma;
  const specId = parseInt(req.params.id, 10);

  try {
    const versions = await prisma.specVersion.findMany({
      where: { specId },
      orderBy: { versionNumber: 'asc' },
    });

    res.json(versions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении версий ТЗ' });
  }
});

/**
 * POST /api/specs/:id/versions/:versionNumber/fork
 * Создать новую версию на основе существующей (черновик)
 */
router.post('/:id/versions/:versionNumber/fork', async (req, res) => {
  const prisma = req.prisma;
  const specId = parseInt(req.params.id, 10);
  const versionNumber = parseInt(req.params.versionNumber, 10);
  const { createdById, comment } = req.body;

  try {
    const baseVersion = await prisma.specVersion.findFirst({
      where: { specId, versionNumber },
    });

    if (!baseVersion) {
      return res.status(404).json({ error: 'Базовая версия не найдена' });
    }

    const lastVersion = await prisma.specVersion.findFirst({
      where: { specId },
      orderBy: { versionNumber: 'desc' },
    });

    const newVersionNumber = (lastVersion?.versionNumber || 0) + 1;

    const result = await prisma.$transaction(async (tx) => {
      // создаём новую версию
      const newVersion = await tx.specVersion.create({
        data: {
          specId,
          versionNumber: newVersionNumber,
          status: 'draft',
          createdById: createdById || null,
          basedOnVersionId: baseVersion.id,
          comment: comment || `Новая версия на основе ${versionNumber}`,
        },
      });

      // копируем шаги и переходы
      const baseSteps = await tx.specStep.findMany({
        where: { versionId: baseVersion.id },
      });

      const stepIdMap = new Map(); // старый id -> новый id

      for (const step of baseSteps) {
        const newStep = await tx.specStep.create({
          data: {
            versionId: newVersion.id,
            stepKey: step.stepKey || uuidv4(),
            type: step.type,
            title: step.title,
            description: step.description,
            posX: step.posX,
            posY: step.posY,
            metadata: step.metadata,
          },
        });

        stepIdMap.set(step.id, newStep.id);
      }

      const baseTransitions = await tx.specStepTransition.findMany({
        where: { versionId: baseVersion.id },
      });

      for (const tr of baseTransitions) {
        await tx.specStepTransition.create({
          data: {
            versionId: newVersion.id,
            fromStepId: stepIdMap.get(tr.fromStepId),
            toStepId: stepIdMap.get(tr.toStepId),
            label: tr.label,
            condition: tr.condition,
            metadata: tr.metadata,
          },
        });
      }

      return newVersion;
    });

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при создании новой версии' });
  }
});

/**
 * GET /api/specs/:id/versions/compare?from=<versionId>&to=<versionId>
 * Сравнить две версии одного ТЗ
 */
router.get('/:id/versions/compare', async (req, res) => {
  const prisma = req.prisma;
  const specId = parseInt(req.params.id, 10);
  const fromVersionId = parseInt(req.query.from, 10);
  const toVersionId = parseInt(req.query.to, 10);

  if (Number.isNaN(specId) || Number.isNaN(fromVersionId) || Number.isNaN(toVersionId)) {
    return res.status(400).json({ error: 'Некорректные параметры specId/from/to' });
  }

  try {
    const fromVersion = await prisma.specVersion.findUnique({
      where: { id: fromVersionId },
      include: {
        steps: true,
        transitions: true,
      },
    });

    const toVersion = await prisma.specVersion.findUnique({
      where: { id: toVersionId },
      include: {
        steps: true,
        transitions: true,
      },
    });

    if (!fromVersion || !toVersion) {
      return res.status(404).json({ error: 'Одна из версий не найдена' });
    }

    if (fromVersion.specId !== specId || toVersion.specId !== specId) {
      return res.status(400).json({ error: 'Версии не принадлежат указанному ТЗ' });
    }

    // ---------- DIFF ПО БЛОКАМ (STEPS) ----------

    const fromStepsByKey = new Map();
    fromVersion.steps.forEach((s) => {
      fromStepsByKey.set(s.stepKey, s);
    });

    const toStepsByKey = new Map();
    toVersion.steps.forEach((s) => {
      toStepsByKey.set(s.stepKey, s);
    });

    const stepsAdded = [];
    const stepsRemoved = [];
    const stepsChanged = [];

    // Добавленные и изменённые (смотрим по новой версии)
    for (const [stepKey, toStep] of toStepsByKey.entries()) {
      const fromStep = fromStepsByKey.get(stepKey);

      if (!fromStep) {
        stepsAdded.push({
          stepKey,
          title: toStep.title,
          description: toStep.description,
          type: toStep.type,
        });
      } else {
        // Проверяем изменения (по title/description/type)
        if (
          fromStep.title !== toStep.title ||
          (fromStep.description || '') !== (toStep.description || '') ||
          fromStep.type !== toStep.type
        ) {
          stepsChanged.push({
            stepKey,
            from: {
              title: fromStep.title,
              description: fromStep.description,
              type: fromStep.type,
            },
            to: {
              title: toStep.title,
              description: toStep.description,
              type: toStep.type,
            },
          });
        }
      }
    }

    // Удалённые (есть в старой, нет в новой)
    for (const [stepKey, fromStep] of fromStepsByKey.entries()) {
      if (!toStepsByKey.has(stepKey)) {
        stepsRemoved.push({
          stepKey,
          title: fromStep.title,
          description: fromStep.description,
          type: fromStep.type,
        });
      }
    }

    // ---------- DIFF ПО СТРЕЛКАМ (TRANSITIONS) ----------
    // Для сопоставления стрелок нам нужны stepKey по fromStepId/toStepId

    const fromIdToKey = new Map();
    fromVersion.steps.forEach((s) => fromIdToKey.set(s.id, s.stepKey));

    const toIdToKey = new Map();
    toVersion.steps.forEach((s) => toIdToKey.set(s.id, s.stepKey));

    function buildEdgeKey(fromKey, toKey, label) {
      return `${fromKey}->${toKey}|${label || ''}`;
    }

    const fromEdgesSet = new Map(); // key -> объект
    fromVersion.transitions.forEach((tr) => {
      const fromKey = fromIdToKey.get(tr.fromStepId);
      const toKey = fromIdToKey.get(tr.toStepId);
      if (!fromKey || !toKey) return;
      const key = buildEdgeKey(fromKey, toKey, tr.label);
      fromEdgesSet.set(key, {
        fromKey,
        toKey,
        label: tr.label,
      });
    });

    const toEdgesSet = new Map();
    toVersion.transitions.forEach((tr) => {
      const fromKey = toIdToKey.get(tr.fromStepId);
      const toKey = toIdToKey.get(tr.toStepId);
      if (!fromKey || !toKey) return;
      const key = buildEdgeKey(fromKey, toKey, tr.label);
      toEdgesSet.set(key, {
        fromKey,
        toKey,
        label: tr.label,
      });
    });

    const edgesAdded = [];
    const edgesRemoved = [];

    // Добавленные стрелки
    for (const [key, edge] of toEdgesSet.entries()) {
      if (!fromEdgesSet.has(key)) {
        edgesAdded.push(edge);
      }
    }

    // Удалённые стрелки
    for (const [key, edge] of fromEdgesSet.entries()) {
      if (!toEdgesSet.has(key)) {
        edgesRemoved.push(edge);
      }
    }

    // Ответ
    res.json({
      specId,
      fromVersion: {
        id: fromVersion.id,
        versionNumber: fromVersion.versionNumber,
        status: fromVersion.status,
      },
      toVersion: {
        id: toVersion.id,
        versionNumber: toVersion.versionNumber,
        status: toVersion.status,
      },
      steps: {
        added: stepsAdded,
        removed: stepsRemoved,
        changed: stepsChanged,
      },
      edges: {
        added: edgesAdded,
        removed: edgesRemoved,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при сравнении версий' });
  }
});


export default router;
