import express from 'express';
import { createFootingDesign } from '../controllers/footingController.js';
const router = express.Router();
router.post('/design', createFootingDesign);
export default router;
