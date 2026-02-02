import { useEffect, useCallback, useState, useRef } from "react";
import axios from "axios";
import * as XLSX from "xlsx";

import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
} from "reactflow";

import "reactflow/dist/style.css";

const API_BASE = "http://localhost:3000/api";

// 🔹 Базовый стиль блока по типу + модификация по diffStatus
function getNodeStyle(realType, diffStatus) {
  let base = {};


  switch (realType) {
    case "start":
      base = {
        background: "#d1fae5", // зелёный
        border: "2px solid #10b981",
        borderRadius: "999px",
        padding: 10,
        minWidth: 120,
        textAlign: "center",
      };
      break;
    case "condition":
      base = {
        background: "#fee2e2", // красный/розовый
        border: "2px solid #ef4444",
        borderRadius: 4,
        padding: 10,
        minWidth: 160,
      };
      break;
    case "end":
      base = {
        background: "#e5e7eb", // серый
        border: "2px solid #4b5563",
        borderRadius: "999px",
        padding: 10,
        minWidth: 120,
        textAlign: "center",
      };
      break;
    case "action":
    default:
      base = {
        background: "#e0f2fe", // голубой
        border: "2px solid #3b82f6",
        borderRadius: 6,
        padding: 10,
        minWidth: 160,
      };
      break;
  }

  // Подсветка diff (новые/изменённые блоки)
  if (diffStatus === "added") {
    base.boxShadow = "0 0 0 3px #22c55e"; // зелёная обводка
  } else if (diffStatus === "changed") {
    base.boxShadow = "0 0 0 3px #f97316"; // оранжевая обводка
  }

  return base;
}

// 🔹 Кастомный узел: текст + ручки + визуал diff
function BlockNode({ data }) {
  const style = getNodeStyle(data.realType || "action", data.diffStatus);

  return (
    <div style={{ position: "relative" }}>
      {/* Входящая ручка сверху */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "#111827", width: 8, height: 8 }}
      />
      {/* Исходящая ручка снизу */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "#111827", width: 8, height: 8 }}
      />

      <div style={style}>
        <div style={{ fontWeight: "bold" }}>
          {data.title || "(без названия)"}
        </div>
        {data.description && data.description.trim() !== "" && (
          <div style={{ marginTop: 4, fontSize: 12, whiteSpace: "pre-wrap" }}>
            {data.description}
          </div>
        )}
      </div>
    </div>
  );
}

const nodeTypes = {
  block: BlockNode,
};

// Вытаскиваем переходы вида "… переход к шагу 20" из текста
function extractTransitionsFromText(rawText) {
  if (!rawText) return [];

  const text = String(rawText);
  const transitions = [];
  const regex = /переход к шаг[ау]\s+(\d+)/gi;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const targetKey = match[1];

    // Берём кусочек текста перед "переход к шагу", чтобы сделать подпись
    const contextStart = Math.max(0, match.index - 80);
    let context = text.slice(contextStart, match.index).trim();

    // Чистим хвост: точки, запятые, пробелы
    context = context.replace(/[\s\.\,\;\:\-]+$/g, "").trim();

    // Если слишком длинно — сокращаем до последних ~60 символов
    if (context.length > 60) {
      context = "…" + context.slice(-60);
    }

    transitions.push({
      targetKey,
      label: context || "",
    });
  }

  return transitions;
}

function App() {
  // 🔹 Данные по ТЗ и версиям
  const [specs, setSpecs] = useState([]);
  const [versions, setVersions] = useState([]);
  const [currentSpecId, setCurrentSpecId] = useState(null);
  const [currentVersionId, setCurrentVersionId] = useState(null);

  // 🔹 Граф
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [versionInfo, setVersionInfo] = useState(null);

  // 🔹 Diff (сравнение версий)
  const [diffResult, setDiffResult] = useState(null);

  // 🔹 UI: доп. меню внизу сайдбара
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pendingPushVersionId, setPendingPushVersionId] = useState(null);

  // 🔹 Импорт Excel
  const fileInputRef = useRef(null);

  // ================== Загрузка/сохранение графа ==================

  const loadGraph = useCallback(
    async (versionId) => {
      if (!versionId) return;

      setLoading(true);
      setError(null);

      try {
        // 1) Версия
        const versionRes = await axios.get(`${API_BASE}/versions/${versionId}`);
        setVersionInfo(versionRes.data);

        // 2) Граф
        const res = await axios.get(`${API_BASE}/versions/${versionId}/graph`);
        let { nodes, edges } = res.data;

        nodes = (nodes || []).map((n) => {
          const realType = n.type || n.data?.realType || "action";
          return {
            id: n.id,
            type: "block",
            position: n.position || { x: 0, y: 0 },
            data: {
              title: n.data?.title || n.title || "",
              description: n.data?.description || "",
              realType,
              diffStatus: null,
            },
          };
        });

        setNodes(nodes);
        setEdges(edges || []);

        // Если граф пустой — добавляем стартовый блок
        if ((nodes || []).length === 0) {
          const startNode = {
            id: "start-1",
            type: "block",
            position: { x: 100, y: 100 },
            data: {
              title: "Старт",
              description: "",
              realType: "start",
              diffStatus: null,
            },
          };
          setNodes([startNode]);
        }
      } catch (err) {
        console.error(err);
        setError("Ошибка при загрузке графа/версии");
      } finally {
        setLoading(false);
      }
    },
    [setNodes, setEdges]
  );

  // ================== Загрузка данных о ТЗ и версиях ==================

  const loadVersionsForSpec = useCallback(
    async (specId, preferredVersionId = null) => {
      try {
        const res = await axios.get(`${API_BASE}/specs/${specId}/versions`);
        const versionsFromApi = res.data || [];
        setVersions(versionsFromApi);

        setDiffResult(null);

        if (versionsFromApi.length === 0) {
          setCurrentVersionId(null);
          setNodes([]);
          setEdges([]);
          setVersionInfo(null);
          return;
        }

        let chosenVersion = null;

        if (preferredVersionId) {
          chosenVersion = versionsFromApi.find(
            (v) => v.id === preferredVersionId
          );
        }
        if (!chosenVersion) {
          chosenVersion = versionsFromApi[versionsFromApi.length - 1];
        }

        setCurrentVersionId(chosenVersion.id);
        await loadGraph(chosenVersion.id);
      } catch (err) {
        console.error(err);
        setError("Ошибка при загрузке версий ТЗ");
      }
    },
    [loadGraph, setNodes, setEdges]
  );

  const loadSpecs = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/specs`);
      const specsFromApi = res.data || [];
      setSpecs(specsFromApi);

      if (!currentSpecId && specsFromApi.length > 0) {
        const firstSpec = specsFromApi[0];
        setCurrentSpecId(firstSpec.id);
        await loadVersionsForSpec(firstSpec.id, firstSpec.currentVersionId);
      }
    } catch (err) {
      console.error(err);
      setError("Ошибка при загрузке списка ТЗ");
    }
  }, [loadVersionsForSpec, currentSpecId]);

  useEffect(() => {
    loadSpecs();
  }, [loadSpecs]);

  // ================== Работа с графом (узлы/стрелки) ==================

  const addNode = (type = "action") => {
    setNodes((nds) => {
      const id = "node-" + Date.now();
      const newNode = {
        id,
        type: "block",
        position: { x: 100 + nds.length * 50, y: 100 + nds.length * 30 },
        data: {
          title:
            type === "condition"
              ? "Условие"
              : type === "start"
              ? "Старт"
              : type === "end"
              ? "Конец"
              : "Шаг",
          description: "",
          realType: type,
          diffStatus: null,
        },
      };
      return [...nds, newNode];
    });
  };

  const onConnect = useCallback(
    (params) => {
      setEdges((eds) => addEdge({ ...params, animated: false }, eds));
    },
    [setEdges]
  );

  const onNodeDoubleClick = useCallback(
    (event, node) => {
      const oldTitle = node.data?.title || "";
      const oldDesc = node.data?.description || "";

      const newTitle = window.prompt("Введите заголовок блока", oldTitle);
      if (newTitle === null) return;

      const newDesc = window.prompt(
        "Введите описание блока (можно оставить пустым)",
        oldDesc
      );
      if (newDesc === null) return;

      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? {
                ...n,
                data: {
                  ...n.data,
                  title: newTitle,
                  description: newDesc,
                },
              }
            : n
        )
      );
    },
    [setNodes]
  );

  const onEdgeDoubleClick = useCallback(
    (event, edge) => {
      event.stopPropagation();

      const newLabel = window.prompt(
        'Подпись на стрелке (Да/Нет и т.п.).\nОставьте поле пустым и нажмите ОК, чтобы удалить стрелку.',
        edge.label || ""
      );
      if (newLabel === null) return;

      if (newLabel === "") {
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      } else {
        setEdges((eds) =>
          eds.map((e) =>
            e.id === edge.id
              ? {
                  ...e,
                  label: newLabel,
                }
              : e
          )
        );
      }
    },
    [setEdges]
  );

  const saveGraph = async () => {
    if (!currentVersionId) return;

    setSaving(true);
    setError(null);

    try {
      const preparedNodes = nodes.map((n) => ({
        ...n,
        type: n.data?.realType || "action",
      }));

      await axios.put(`${API_BASE}/versions/${currentVersionId}/graph`, {
        nodes: preparedNodes,
        edges,
        plainText: null,
        comment: "Сохранено из React Flow",
      });

      if (pendingPushVersionId === currentVersionId && currentSpecId) {
        await loadVersionsForSpec(currentSpecId, currentVersionId);
        setPendingPushVersionId(null);
      }

      alert("Сохранено!");
    } catch (err) {
      console.error(err);
      setError("Ошибка при сохранении графа");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status) => {
    if (!currentVersionId) return;

    try {
      await axios.post(`${API_BASE}/versions/${currentVersionId}/status`, {
        status,
      });
      const versionRes = await axios.get(
        `${API_BASE}/versions/${currentVersionId}`
      );
      setVersionInfo(versionRes.data);

      if (currentSpecId) {
        const spec = specs.find((s) => s.id === currentSpecId);
        await loadVersionsForSpec(currentSpecId, spec?.currentVersionId);
      }
    } catch (err) {
      console.error(err);
      setError("Ошибка при смене статуса");
    }
  };

  const createNewDraftVersion = async () => {
    if (!currentSpecId || !currentVersionId) return;

    try {
      const currentVersion = versions.find((v) => v.id === currentVersionId);
      if (!currentVersion) return;

      const response = await axios.post(
        `${API_BASE}/specs/${currentSpecId}/versions/${currentVersion.versionNumber}/fork`,
        {
          createdById: null,
          comment: "Новая версия из интерфейса",
        }
      );

      const newVersion = response.data;
      setPendingPushVersionId(newVersion?.id || null);
      await loadVersionsForSpec(currentSpecId, newVersion?.id);
      alert("Создана новая версия (черновик)");
    } catch (err) {
      console.error(err);
      setError("Ошибка при создании новой версии");
    }
  };

  // 🔹 СОЗДАНИЕ НОВОГО ТЗ
  const createNewSpec = async () => {
    try {
      const title = window.prompt("Название нового ТЗ");
      if (!title || !title.trim()) {
        return;
      }

      const description = window.prompt(
        "Краткое описание ТЗ (необязательно)",
        ""
      );

      const payload = {
        title: title.trim(),
        description:
          description && description.trim() ? description.trim() : null,
        createdById: null,
      };

      const res = await axios.post(`${API_BASE}/specs`, payload);
      const { spec, version } = res.data || {};

      if (!spec || !spec.id) {
        await loadSpecs();
        return;
      }

      const listRes = await axios.get(`${API_BASE}/specs`);
      const specsFromApi = listRes.data || [];
      setSpecs(specsFromApi);

      setCurrentSpecId(spec.id);
      await loadVersionsForSpec(
        spec.id,
        (version && version.id) || spec.currentVersionId
      );
    } catch (err) {
      console.error(err);
      setError("Ошибка при создании нового ТЗ");
    }
  };

  // ================== Diff (сравнение версий) ==================

  const handleSpecChange = async (e) => {
    const specId = parseInt(e.target.value, 10);
    setCurrentSpecId(specId);

    const spec = specs.find((s) => s.id === specId);
    await loadVersionsForSpec(specId, spec?.currentVersionId);
  };

  const loadDiffFor = async (compareId) => {
    if (!currentSpecId || !currentVersionId || !compareId) {
      return;
    }

    setError(null);

    try {
      const res = await axios.get(
        `${API_BASE}/specs/${currentSpecId}/versions/compare`,
        {
          params: {
            from: compareId,
            to: currentVersionId,
          },
        }
      );

      setDiffResult(res.data);
    } catch (err) {
      console.error(err);
      setError("Ошибка при загрузке отличий между версиями");
    }
  };

  const handleCompareWithPrevious = async (previousVersion) => {
    if (!previousVersion) return;
    setDiffResult(null);
    await loadDiffFor(previousVersion.id);
  };

  // ================== Импорт из Excel (с ветками и критериями) ==================

  const handleExcelFileChange = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });

      // 1) выбираем лист: сначала ищем «Сценарий», если нет — берём первый
      let sheetName =
        workbook.SheetNames.find((n) =>
          n.toLowerCase().includes("сценар")
        ) || workbook.SheetNames[0];

      let sheet = workbook.Sheets[sheetName];

      // 2) Массив строк, чтобы найти заголовки
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
      });

      if (!rows || rows.length === 0) {
        throw new Error("Лист в Excel пустой");
      }

      // 3) Ищем строку "ТАБЛИЧНОЕ ОПИСАНИЕ ШАГОВ СЦЕНАРИЯ"
      let headerRowIndex = -1;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowStrs = row.map((c) => String(c).toLowerCase());
        if (
          rowStrs.some((cell) =>
            cell.includes("табличное описание шагов сценария")
          )
        ) {
          headerRowIndex = i + 1; // следующая строка — заголовки таблицы
          break;
        }
      }

      // 4) Если не нашли блок, ищем строку, где первый столбец "№" и есть "шаг сценария"
      if (headerRowIndex === -1) {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          const c0 = String(row[0]).trim().toLowerCase();
          const rowStrs = row.map((c) => String(c).toLowerCase());
          if (
            (c0 === "№" || c0 === "no" || c0 === "n") &&
            rowStrs.some((cell) => cell.includes("шаг сценария"))
          ) {
            headerRowIndex = i;
            break;
          }
        }
      }

      if (headerRowIndex === -1) {
        throw new Error("Не удалось найти таблицу шагов сценария в Excel");
      }

      const header = rows[headerRowIndex];

      // 5) Находим индексы нужных колонок
      const findCol = (predicate) =>
        header.findIndex((c) => {
          const s = String(c).toLowerCase();
          return predicate(s);
        });

      const idxNum = findCol((s) => s === "№" || s.startsWith("№"));
      const idxTitle = findCol((s) => s.includes("шаг сценария"));
      const idxDescr = findCol((s) => s.includes("описание шага"));
      const idxCrit = findCol((s) => s.includes("критерий успешности"));
      const idxErr = findCol((s) => s.includes("обработка ошибок"));
      const idxDevNote = findCol((s) =>
        s.includes("примечание для разработчика")
      );

      if (idxNum === -1 || idxTitle === -1) {
        throw new Error(
          'Не найдены колонки "№" и/или "Шаг сценария" в таблице'
        );
      }

      const steps = [];
      const dataStart = headerRowIndex + 1;

      // 6) Собираем шаги
      for (let i = dataStart; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const rawNum = row[idxNum];
        let numStr = String(rawNum).trim();

        // пропускаем пустые и текстовые строки
        if (!numStr) continue;
        if (!/\d/.test(numStr)) continue;

        const titleRaw = row[idxTitle];
        const title =
          (titleRaw && String(titleRaw).trim()) || `Шаг ${numStr}` || "Шаг";

        const rawDescr = idxDescr !== -1 ? row[idxDescr] : "";
        const rawCrit = idxCrit !== -1 ? row[idxCrit] : "";
        const rawErr = idxErr !== -1 ? row[idxErr] : "";
        const rawDevNote = idxDevNote !== -1 ? row[idxDevNote] : "";

        const descrParts = [];

        if (rawDescr) {
          descrParts.push(String(rawDescr).trim());
        }
        if (rawCrit) {
          descrParts.push("Критерий: " + String(rawCrit).trim());
        }
        if (rawErr) {
          descrParts.push("Ошибки: " + String(rawErr).trim());
        }

        const description = descrParts.filter(Boolean).join("\n\n");

        steps.push({
          key: numStr,
          title,
          description,
          originalIndex: i,
          rawDescr: rawDescr ? String(rawDescr) : "",
          rawCrit: rawCrit ? String(rawCrit) : "",
          rawDevNote: rawDevNote ? String(rawDevNote) : "",
        });
      }

      if (steps.length === 0) {
        throw new Error("Не найдено ни одного шага сценария в таблице");
      }

      // 7) Сортируем шаги по номеру (если можем)
      const stepsSorted = [...steps].sort((a, b) => {
        const aNum = parseFloat(a.key.replace(",", "."));
        const bNum = parseFloat(b.key.replace(",", "."));

        if (!isNaN(aNum) && !isNaN(bNum)) {
          return aNum - bNum;
        }
        return a.originalIndex - b.originalIndex;
      });

      // 8) Узлы
      const newNodes = stepsSorted.map((step, idx) => {
        let realType = "action";

        if (idx === 0) realType = "start";
        else if (idx === stepsSorted.length - 1) realType = "end";
        else {
          const t = step.title.toLowerCase();
          if (t.includes("проверка") || t.includes("проверяется")) {
            realType = "condition";
          }
        }

        return {
          id: step.key,
          type: "block",
          position: {
            x: 100 + idx * 60,
            y: 80 + idx * 30,
          },
          data: {
            title: step.title,
            description: step.description,
            realType,
            diffStatus: null,
          },
        };
      });

      const nodeIds = new Set(newNodes.map((n) => n.id));

      // 9) ЯВНЫЕ переходы из текста "Переход к шагу N" (описание + критерий + примечание)
      const explicitEdges = [];
      const outgoingByFrom = new Map(); // fromKey -> [{target, label}]

      for (const step of stepsSorted) {
        const fromKey = step.key;
        const textForParsing =
          (step.rawDescr ? step.rawDescr + "\n" : "") +
          (step.rawCrit ? step.rawCrit + "\n" : "") +
          (step.rawDevNote ? step.rawDevNote : "");

        const transitions = extractTransitionsFromText(textForParsing);

        if (!transitions.length) continue;

        const arr = outgoingByFrom.get(fromKey) || [];

        for (const tr of transitions) {
          const targetKey = tr.targetKey;
          if (!targetKey) continue;

          // если узла с таким ID нет — создаём "пустышку"
          if (!nodeIds.has(targetKey)) {
            newNodes.push({
              id: targetKey,
              type: "block",
              position: {
                x: 400,
                y: 80 + newNodes.length * 30,
              },
              data: {
                title: `Шаг ${targetKey}`,
                description: "",
                realType: "action",
                diffStatus: null,
              },
            });
            nodeIds.add(targetKey);
          }

          if (arr.some((e) => e.target === targetKey)) continue;

          arr.push({ target: targetKey, label: tr.label || "" });
          explicitEdges.push({
            from: fromKey,
            to: targetKey,
            label: tr.label || "",
          });
        }

        outgoingByFrom.set(fromKey, arr);
      }

      const newEdges = [];
      const edgeKeySet = new Set();

      // 9.1 Добавляем явные переходы
      explicitEdges.forEach((e, idx) => {
        const edgeId = `${e.from}->${e.to}-${idx}`;
        newEdges.push({
          id: edgeId,
          source: e.from,
          target: e.to,
          label: e.label || undefined,
        });
        edgeKeySet.add(`${e.from}->${e.to}`);
      });

      // 9.2 Если явных переходов нет вообще — делаем простую цепочку, как раньше
      if (explicitEdges.length === 0) {
        for (let i = 0; i < stepsSorted.length - 1; i++) {
          const from = stepsSorted[i];
          const to = stepsSorted[i + 1];

          newEdges.push({
            id: `${from.key}->${to.key}`,
            source: from.key,
            target: to.key,
          });
        }
      } else {
        // 9.3 Если явные переходы есть, добавляем линейную связь ТОЛЬКО для тех шагов, у которых нет своих переходов
        for (let i = 0; i < stepsSorted.length - 1; i++) {
          const from = stepsSorted[i];
          const to = stepsSorted[i + 1];

          const hasOutgoing = outgoingByFrom.has(from.key);
          const ek = `${from.key}->${to.key}`;

          if (!hasOutgoing && !edgeKeySet.has(ek)) {
            newEdges.push({
              id: ek,
              source: from.key,
              target: to.key,
            });
            edgeKeySet.add(ek);
          }
        }
      }

      setNodes(newNodes);
      setEdges(newEdges);

      if (!currentVersionId) {
        alert(
          'Схема из Excel построена. Выбери ТЗ и версию и нажми "Сохранить граф", чтобы сохранить её.'
        );
      } else {
        alert(
          'Схема из Excel построена. Нажми "Сохранить граф", чтобы записать её в текущую версию.'
        );
      }
    } catch (err) {
      console.error(err);
      setError(
        "Ошибка при импорте Excel-файла: " + (err.message || String(err))
      );
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const triggerExcelImport = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // ================== Формирование подсветки (diff) ==================

  const displayNodes = nodes.map((n) => {
    let diffStatus = null;

    const stepsSection =
      diffResult?.steps ?? { added: [], removed: [], changed: [] };
    const key = n.id;

    if (stepsSection.added.some((s) => s.stepKey === key)) {
      diffStatus = "added";
    } else if (stepsSection.changed.some((s) => s.stepKey === key)) {
      diffStatus = "changed";
    }

    return {
      ...n,
      data: {
        ...n.data,
        diffStatus,
      },
    };
  });

  const displayEdges = edges.map((e) => {
    let style = e.style || {};

    const edgesSection =
      diffResult?.edges ?? { added: [], removed: [], changed: [] };

    const isAdded = edgesSection.added.some(
      (edge) =>
        edge.fromKey === e.source &&
        edge.toKey === e.target &&
        (edge.label || "") === (e.label || "")
    );

    if (isAdded) {
      style = {
        ...style,
        stroke: "#22c55e",
        strokeWidth: 2,
      };
    }

    return {
      ...e,
      style,
    };
  });

  // ================== Тексты для хедера и сайдбара ==================

  const statusText = versionInfo?.status || "неизвестно";
  const specTitle =
    specs.find((s) => s.id === currentSpecId)?.title || "Без названия ТЗ";
  const versionNumber = versionInfo?.versionNumber || "?";
  const currentVersion = versions.find((v) => v.id === currentVersionId);
  const sortedVersions = [...versions].sort(
    (a, b) => a.versionNumber - b.versionNumber
  );
  const previousVersion = currentVersion
    ? [...sortedVersions]
        .filter((v) => v.versionNumber < currentVersion.versionNumber)
        .pop()
    : null;
  const isPendingPush = pendingPushVersionId === currentVersionId;

  return (
    <div className="flex h-screen flex-col bg-slate-900">
      {/* ВЕРХНИЙ ХЕДЕР */}
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-sky-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-300">
            X5 Version Center
          </div>
          <span className="text-xs font-medium text-slate-200">AWX</span>
        </div>

        <button
          type="button"
          className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-red-400 active:translate-y-px"
        >
          Выход
        </button>
      </header>

      {/* НИЖЕ – ОСНОВНОЙ ЛЕЙАУТ: ЛЕВОЕ МЕНЮ + ПРАВАЯ ОБЛАСТЬ */}
      <div className="flex flex-1 bg-slate-100 text-slate-900">
        {/* ЛЕВОЕ МЕНЮ */}
        <aside
          className={`flex flex-col border-r border-slate-800 bg-slate-900 text-slate-100 transition-all duration-200 ${
            sidebarCollapsed ? "w-14" : "w-80"
          }`}
        >
          {/* Верхняя часть: бренд + текущая версия */}
          <div className="flex items-start justify-between gap-2 border-b border-slate-800 px-4 py-3">
            {!sidebarCollapsed && (
              <div className="text-xs text-slate-300">
                <div className="truncate font-medium">{specTitle}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  Версия v{versionNumber} · {statusText}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-700"
              aria-label={
                sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"
              }
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>
          </div>

          {/* Прокручиваемая середина */}
          {!sidebarCollapsed && (
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
            {/* Блок выбора ТЗ */}
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Техническое задание
                </h3>
                <button
                  onClick={createNewSpec}
                  className="rounded-md bg-sky-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-sky-500"
                >
                  Новое
                </button>
              </div>

              <select
                value={currentSpecId || ""}
                onChange={handleSpecChange}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500"
              >
                {specs.map((spec) => (
                  <option key={spec.id} value={spec.id}>
                    {spec.title} (id:{spec.id})
                  </option>
                ))}
              </select>

              <button
                onClick={loadSpecs}
                disabled={loading}
                className="mt-2 w-full rounded-md bg-white/5 px-2 py-1.5 text-[11px] font-medium text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Обновить список ТЗ
              </button>
            </section>

            {/* Блок версий */}
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Версии
              </h3>

              <div className="space-y-1">
                <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-2 text-[11px] text-slate-200">
                  <div className="text-[10px] uppercase text-slate-500">
                    Сейчас открыта
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-semibold">
                      v{versionNumber || "—"}
                    </span>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                      {statusText}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase text-slate-500">
                    Текущая версия (актуальная)
                  </span>
                  <div className="rounded-md border border-slate-800 bg-slate-900/80 px-2 py-1 text-xs text-slate-200">
                    v{versionNumber} · {statusText}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleCompareWithPrevious(previousVersion)}
                  disabled={!previousVersion}
                  className="w-full rounded-md bg-sky-600 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Сравнить с предыдущей
                </button>

                <button
                  onClick={createNewDraftVersion}
                  disabled={!currentVersionId}
                  className="mt-1 w-full rounded-md bg-slate-800 px-2 py-1.5 text-[11px] font-medium text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Создать новую версию
                </button>

                {isPendingPush && (
                  <div className="text-[10px] text-slate-400">
                    Сохранение отправит новую версию автоматически.
                  </div>
                )}
              </div>
            </section>

            {/* Блок шагов / графа */}
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Схема
              </h3>

              <div className="grid grid-cols-1 gap-1.5">
                <button
                  onClick={() => addNode("action")}
                  className="w-full rounded-md bg-white px-2 py-1.5 text-[11px] font-medium text-slate-900 hover:bg-slate-100"
                >
                  Добавить шаг
                </button>
                <button
                  onClick={() => addNode("condition")}
                  className="w-full rounded-md bg-amber-500 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-amber-400"
                >
                  Добавить условие
                </button>
                <button
                  onClick={() => addNode("end")}
                  className="w-full rounded-md bg-rose-500 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-rose-400"
                >
                  Добавить конец
                </button>
                <button
                  onClick={triggerExcelImport}
                  className="w-full rounded-md bg-emerald-500 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-400"
                >
                  Импорт из Excel
                </button>
              </div>

              <button
                onClick={saveGraph}
                disabled={saving || !currentVersionId}
                className="mt-2 w-full rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Сохранение…" : "Сохранить граф"}
              </button>

              {/* скрытый input для выбора файла Excel */}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                ref={fileInputRef}
                onChange={handleExcelFileChange}
                className="hidden"
              />
            </section>

            {/* Статусы версий */}
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Статус версии
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => changeStatus("draft")}
                  disabled={!currentVersionId}
                  className="rounded-md bg-slate-800 px-2 py-1.5 text-[11px] font-medium text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Черновик
                </button>
                <button
                  onClick={() => changeStatus("published")}
                  disabled={!currentVersionId}
                  className="rounded-md bg-indigo-600 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Опубликовать
                </button>
              </div>
            </section>
          </div>
          )}

          {/* Низ меню: доп. опции + ошибки */}
          {!sidebarCollapsed && (
            <div className="border-t border-slate-800 px-4 py-3 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Дополнительно</span>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setHeaderMenuOpen((prev) => !prev)}
                    className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-700"
                  >
                    Меню
                  </button>
                  {headerMenuOpen && (
                    <div className="dropdown-anim absolute right-0 bottom-7 z-20 w-44 rounded-md bg-slate-800 text-[11px] text-slate-100 shadow-lg ring-1 ring-black/20">
                      <button
                        type="button"
                        className="block w-full px-3 py-1.5 text-left hover:bg-slate-700"
                      >
                        Экспорт YAML (скоро)
                      </button>
                      <button
                        type="button"
                        className="block w-full px-3 py-1.5 text-left hover:bg-slate-700"
                      >
                        Дублировать ТЗ (скоро)
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div className="mt-2 rounded-md border border-red-400 bg-red-100 px-2 py-1.5 text-[11px] text-red-700">
                  {error}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ПРАВАЯ ЧАСТЬ: только схема без нижней панели отличий */}
        <div className="flex flex-1 flex-col">
          <div className="flex-1 min-h-0">
            <ReactFlow
              nodes={displayNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDoubleClick={onNodeDoubleClick}
              onEdgeDoubleClick={onEdgeDoubleClick}
              fitView
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
