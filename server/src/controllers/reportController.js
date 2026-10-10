import mongoose from 'mongoose';
import { generatePdfReport } from '../services/reportService.js';
import { generateSlabDesign } from '../services/slabCalculationService.js';
import { generateColumnDesign } from '../services/columnCalculationService.js';
import { generateFootingDesign } from '../services/footingCalculationService.js';
import { generateFootingPdfReport } from '../services/footingReportService.js';
import SlabDesign from '../models/SlabDesign.js';

export async function createReport(req, res) {
  const payload = req.body;
  let result;

  try {
    result = payload.result?.designType === 'Slab'
      ? generateSlabDesign(payload)
      : payload.result?.designType === 'Column'
        ? generateColumnDesign(payload)
        : payload.result?.designType === 'Footing'
          ? generateFootingDesign(payload)
        : payload.result;
  } catch (error) {
    // Input validation belongs to the calculation contract.  Return its exact message
    // instead of reporting it as a PDF-generation failure.
    return res.status(400).json({ error: error.message });
  }

  try {
    const reportPayload = { ...payload, result };
    const pdfBuffer = result?.designType === 'Footing'
      ? await generateFootingPdfReport(reportPayload)
      : await generatePdfReport(reportPayload);

    if (req.user && mongoose.connection.readyState === 1) {
      try {
        const designDoc = new SlabDesign({
          ownerId: req.user.id,
          user: { email: req.user.email, name: req.user.name },
          projectName: payload.projectName,
          designerName: payload.designerName,
          date: payload.date,
          remarks: payload.remarks,
          designType: result?.designType || 'Slab',
          inputValues: payload,
          result
        });
        await designDoc.save();
      } catch (saveError) {
        console.warn('Report persistence skipped because the database is unavailable:', saveError.message);
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${result?.designType?.toLowerCase() || 'design'}-report.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
