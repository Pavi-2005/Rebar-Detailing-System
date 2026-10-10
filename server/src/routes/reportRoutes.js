import express from 'express';
import { createReport } from '../controllers/reportController.js';

const router = express.Router();

router.post('/pdf', createReport);

export default router;
