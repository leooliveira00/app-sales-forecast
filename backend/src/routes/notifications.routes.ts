import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware.js";
import * as NotificationsController from "../controllers/notifications.controller.js";

const router = Router();

router.use(authenticate);

router.get("/unread-count",    NotificationsController.unreadCount);
router.get("/",                NotificationsController.list);
router.patch("/:id/read",      NotificationsController.markRead);
router.post("/mark-all-read",  NotificationsController.markAllRead);

export default router;
