import express from 'express';

const router = express.Router();

/**
 * GET /api/versions/:id
 * Получить информацию о версии (статус и т.д.)
 */
router.get('/:id', async (req, res) => {
  const prisma = req.prisma;
  const versionId = parseInt(req.params.id, 10);

  if (Number.isNaN(versionId)) {
    return res.status(400).json({ error: 'Некорректный id версии' });
  }

  try {
    const version = await prisma.specVersion.findUnique({
      where: { id: versionId },
      include: {
        spec: true, // заодно вернём и саму карточку ТЗ
      },
    });

    if (!version) {
      return res.status(404).json({ error: 'Версия не найдена' });
    }

    res.json(version);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении версии' });
  }
});


/**
 * GET /api/versions/:id/graph
 * Получить блок-схему (узлы + связи) для версии
 */
router.get('/:id/graph', async (req, res) => {
  const prisma = req.prisma;
  const versionId = parseInt(req.params.id, 10);

  if (Number.isNaN(versionId)) {
    return res.status(400).json({ error: 'Некорректный id версии' });
  }

  try {
    // Загружаем версию с шагами и переходами
    const version = await prisma.specVersion.findUnique({
      where: { id: versionId },
      include: {
        steps: true,
        transitions: true,
      },
    });

    if (!version) {
      return res.status(404).json({ error: 'Версия не найдена' });
    }

    // Преобразуем шаги в nodes для React Flow
    const nodes = version.steps.map((step) => ({
      id: step.stepKey, // стабильный ключ узла
      type: step.type,  // 'start' | 'action' | 'condition' | 'end'
      position: {
        x: step.posX,
        y: step.posY,
      },
      data: {
        title: step.title,
        description: step.description,
      },
    }));

    // Создаём map: step.id -> step.stepKey
    const idToKey = new Map();
    version.steps.forEach((step) => {
      idToKey.set(step.id, step.stepKey);
    });

    // Преобразуем переходы в edges
    const edges = version.transitions.map((tr) => ({
      id: String(tr.id),
      source: idToKey.get(tr.fromStepId),
      target: idToKey.get(tr.toStepId),
      label: tr.label || '',
      data: {
        condition: tr.condition,
      },
    }));

    res.json({ nodes, edges });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при загрузке графа версии' });
  }
});

/**
 * PUT /api/versions/:id/graph
 * Сохранить блок-схему (узлы + связи) для версии
 * body: { nodes: [...], edges: [...], plainText?, comment? }
 */
router.put('/:id/graph', async (req, res) => {
  const prisma = req.prisma;
  const versionId = parseInt(req.params.id, 10);
  const { nodes, edges, plainText, comment } = req.body;

  if (Number.isNaN(versionId)) {
    return res.status(400).json({ error: 'Некорректный id версии' });
  }

  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return res.status(400).json({ error: 'nodes и edges должны быть массивами' });
  }

  try {
    const version = await prisma.specVersion.findUnique({
      where: { id: versionId },
    });

    if (!version) {
      return res.status(404).json({ error: 'Версия не найдена' });
    }

    // Транзакция: удаляем старые шаги/переходы и создаём новые
    const result = await prisma.$transaction(async (tx) => {
      // Сначала удаляем переходы (они ссылаются на шаги)
      await tx.specStepTransition.deleteMany({
        where: { versionId },
      });

      // Потом удаляем шаги
      await tx.specStep.deleteMany({
        where: { versionId },
      });

      // Создаём новые шаги
      const stepKeyToId = new Map();

      for (const node of nodes) {
        // node.id — это stepKey
        const newStep = await tx.specStep.create({
          data: {
            versionId,
            stepKey: String(node.id),
            type: node.type || 'action', // если не указали — пусть будет action
            title: node.data?.title || '',
            description: node.data?.description || null,
            posX: node.position?.x ?? 0,
            posY: node.position?.y ?? 0,
            metadata: node.data?.metadata || null,
          },
        });

        stepKeyToId.set(node.id, newStep.id);
      }

      // Создаём новые переходы
      for (const edge of edges) {
        const fromId = stepKeyToId.get(edge.source);
        const toId = stepKeyToId.get(edge.target);

        if (!fromId || !toId) {
          // некорректная связь — можно пропустить или кинуть ошибку
          console.warn('edge ссылается на несуществующий узел', edge);
          continue;
        }

        await tx.specStepTransition.create({
          data: {
            versionId,
            fromStepId: fromId,
            toStepId: toId,
            label: edge.label || null,
            condition: edge.data?.condition || null,
            metadata: edge.data?.metadata || null,
          },
        });
      }

      // Обновляем текстовое представление и комментарий версии при желании
      const updatedVersion = await tx.specVersion.update({
        where: { id: versionId },
        data: {
          plainText: plainText ?? version.plainText,
          comment: comment ?? version.comment,
        },
      });

      return updatedVersion;
    });

    res.json({ success: true, version: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при сохранении графа версии' });
  }
});

/**
 * POST /api/versions/:id/status
 * Сменить статус версии
 * body: { status: 'draft' | 'in_review' | 'approved' | 'published' | 'archived' }
 */
router.post('/:id/status', async (req, res) => {
  const prisma = req.prisma;
  const versionId = parseInt(req.params.id, 10);
  const { status } = req.body;

  const allowedStatuses = ['draft', 'in_review', 'approved', 'published', 'archived'];

  if (Number.isNaN(versionId)) {
    return res.status(400).json({ error: 'Некорректный id версии' });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Недопустимый статус' });
  }

  try {
    const version = await prisma.specVersion.findUnique({
      where: { id: versionId },
    });

    if (!version) {
      return res.status(404).json({ error: 'Версия не найдена' });
    }

    // Обновляем статус версии
    const updatedVersion = await prisma.specVersion.update({
      where: { id: versionId },
      data: { status },
    });

    // Если статус 'published' — делаем эту версию текущей для её Spec
    if (status === 'published') {
      await prisma.spec.update({
        where: { id: version.specId },
        data: { currentVersionId: versionId },
      });
    }

    res.json(updatedVersion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при смене статуса версии' });
  }
});


export default router;
