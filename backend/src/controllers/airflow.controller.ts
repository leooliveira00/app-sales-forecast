import { Request, Response } from "express";
import * as AirflowService from "../services/airflow.service.js";

export async function getStatus(req: Request, res: Response) {
  try {
    const result = await AirflowService.testConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
}

export async function listDags(req: Request, res: Response) {
  try {
    const data = await AirflowService.listDags();
    res.json(data);
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}

export async function getDagRuns(req: Request, res: Response) {
  try {
    const { dagId } = req.params;
    const limit = Number(req.query.limit) || 10;
    const data = await AirflowService.getDagRuns(dagId, limit);
    res.json(data);
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}

export async function triggerDag(req: Request, res: Response) {
  try {
    const { dagId } = req.params;
    const conf = (req.body?.conf ?? {}) as Record<string, unknown>;
    const data = await AirflowService.triggerDag(dagId, conf);
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}

export async function pauseDag(req: Request, res: Response) {
  try {
    const { dagId } = req.params;
    const { is_paused } = req.body as { is_paused: boolean };
    const data = await AirflowService.pauseDag(dagId, is_paused);
    res.json(data);
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}

export async function cancelDagRun(req: Request, res: Response) {
  try {
    const { dagId, runId } = req.params;
    const data = await AirflowService.cancelDagRun(dagId, runId);
    res.json(data);
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}

export async function clearDagRun(req: Request, res: Response) {
  try {
    const { dagId, runId } = req.params;
    const data = await AirflowService.clearDagRun(dagId, runId);
    res.json(data);
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}

export async function getTaskInstances(req: Request, res: Response) {
  try {
    const { dagId, runId } = req.params;
    const data = await AirflowService.getTaskInstances(dagId, runId);
    res.json(data);
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}

export async function getTaskLog(req: Request, res: Response) {
  try {
    const { dagId, runId, taskId, tryNumber } = req.params;
    const content = await AirflowService.getTaskLog(dagId, runId, taskId, Number(tryNumber));
    res.json({ content });
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}

export async function listVariables(_req: Request, res: Response) {
  try {
    const data = await AirflowService.listVariables();
    res.json(data);
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}

export async function createVariable(req: Request, res: Response) {
  const { key, value, description } = req.body as {
    key: string; value: string; description?: string;
  };
  if (!key?.trim() || value === undefined) {
    return res.status(400).json({ message: "key e value são obrigatórios." });
  }
  try {
    const data = await AirflowService.createVariable(key.trim(), value, description);
    res.status(201).json(data);
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}

export async function updateVariable(req: Request, res: Response) {
  const { key } = req.params;
  const { value, description } = req.body as { value: string; description?: string };
  if (value === undefined) {
    return res.status(400).json({ message: "value é obrigatório." });
  }
  try {
    const data = await AirflowService.updateVariable(key, value, description);
    res.json(data);
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}

export async function deleteVariable(req: Request, res: Response) {
  const { key } = req.params;
  try {
    await AirflowService.deleteVariable(key);
    res.status(204).send();
  } catch (err) {
    res.status(502).json({ message: (err as Error).message });
  }
}
