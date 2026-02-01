// routes/ai.js
import express from "express";
import "dotenv/config";
import Groq from "groq-sdk";

const router = express.Router();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// POST /api/ai/parse-scenario
// body: { steps: [{ key, title, description, rawDescr, rawCrit, rawDevNote }] }
router.post("/parse-scenario", async (req, res) => {
  try {
    const { steps } = req.body;

    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: "steps должен быть непустым массивом" });
    }

    const safeSteps = steps.map((s) => ({
      key: String(s.key),
      title: String(s.title || "").slice(0, 300),
      description: String(s.description || "").slice(0, 1000),
      rawDescr: String(s.rawDescr || "").slice(0, 1000),
      rawCrit: String(s.rawCrit || "").slice(0, 1000),
      rawDevNote: String(s.rawDevNote || "").slice(0, 1000),
    }));

    const systemPrompt = `
Ты помощник для построения графов сценариев AWX по табличному описанию шагов.

Тебе даётся массив шагов (steps). Каждый шаг:
- key: строковый идентификатор шага (обычно номер в таблице).
- title: название шага.
- description: объединённый текст "Описание шага", "Критерий успешности", "Обработка ошибок".
- rawDescr: чистое "Описание шага".
- rawCrit: чистый "Критерий успешности".
- rawDevNote: "Примечание для разработчика".

Нужно вернуть JSON с полями:
{
  "nodes": [
    {
      "id": "1",
      "title": "Название блока",
      "description": "Текст внутри блока",
      "type": "start" | "action" | "condition" | "end"
    },
    ...
  ],
  "edges": [
    {
      "source": "1",
      "target": "3",
      "label": "условие/критерий перехода (можно пустую строку)"
    },
    ...
  ]
}

Правила:
- Обычно первый шаг делай "start", последний — "end".
- Если шаг явно завершает сценарий (создание инцидента и выход, stop, "конец сценария") — тоже "end".
- Если шаг по смыслу что-то проверяет (условия, if, проверка, ветвление) — "condition".
- Остальные — "action".
- Ищи переходы по тексту, например: "переход к шагу 3", "перейти к шагу 4", "идём на шаг 5" и т.п.
- Когда есть несколько разных вариантов исхода (разные сообщения, ошибки, статусы) — рисуй несколько рёбер из одного шага с разными label и target.
- Если в сценарии есть цепочка без явных условий — можешь просто соединять шаг N → N+1.
- НЕ придумывай шаги с id, которых нет в steps.key, кроме случаев когда явно написано "переход к шагу N" и такого step.key нет — тогда можно всё равно использовать этот номер как id, а title делать "Шаг N".
- Ответ ДОЛЖЕН быть строго валидным JSON без пояснений и комментариев.
`.trim();

    const userPrompt = `
Вот массив шагов сценария в JSON:

${JSON.stringify(safeSteps, null, 2)}

Построй, пожалуйста, nodes и edges по правилам из инструкции.
Верни ТОЛЬКО JSON-объект вида { "nodes": [...], "edges": [...] } без дополнительного текста.
`.trim();

    const completion = await groq.chat.completions.create({
      // одну из актуальных моделей Groq, можно поменять позже
      model: "llama3-70b-8192",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const content = completion.choices[0]?.message?.content;

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("Ошибка парсинга JSON от модели:", e, content);
      return res.status(500).json({
        error: "Модель вернула невалидный JSON",
        raw: content,
      });
    }

    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return res.status(500).json({
        error: "Модель вернула неправильную структуру",
        raw: parsed,
      });
    }

    res.json(parsed);
  } catch (err) {
    console.error("AI parse-scenario error:", err);
    res.status(500).json({ error: "Ошибка при обращении к ИИ" });
  }
});

export default router;
