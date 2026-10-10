import test from 'node:test';
import assert from 'node:assert/strict';
import { createReport } from './src/controllers/reportController.js';

const validSlabInput = {
  length: 5,
  width: 3,
  slabThickness: 150,
  wallThickness: 0.15,
  supportType: 'Simply Supported',
  cornerRestraint: 'FREE_TO_LIFT',
  clearCover: 25,
  concreteGrade: 'M35',
  steelGrade: 'Fe500',
  liveLoad: 3,
  floorFinishLoad: 1.5,
  unitWeightConcrete: 25,
  preferredBarDiameter: 12,
  result: { designType: 'Slab' }
};

function responseSpy() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    }
  };
}

test('slab report endpoint returns a PDF from compact report metadata', async () => {
  const res = responseSpy();
  await createReport({ body: validSlabInput }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['content-disposition'], /slab-report\.pdf/);
  assert.ok(Buffer.isBuffer(res.body));
  assert.equal(res.body.subarray(0, 4).toString('latin1'), '%PDF');
});

test('slab report does not require optional project metadata', async () => {
  const { projectName, designerName, date, remarks, ...inputWithoutOptionalMetadata } = validSlabInput;
  const res = responseSpy();
  await createReport({ body: inputWithoutOptionalMetadata }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.equal(res.body.subarray(0, 4).toString('latin1'), '%PDF');
});

test('slab report returns the calculation validation error for invalid required input', async () => {
  const res = responseSpy();
  await createReport({ body: { ...validSlabInput, length: 0 } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /length must be a finite value greater than zero/);
});

test('footing report endpoint regenerates an authoritative PDF from compact metadata', async () => {
  const res = responseSpy();
  await createReport({ body: {
    projectName: 'Footing endpoint test', columnWidth: 300, columnDepth: 300,
    footingLength: 1800, footingWidth: 1800, footingThickness: 450, clearCover: 50,
    preferredBarDiameter: 12, serviceAxialLoad: 500, factoredAxialLoad: 750,
    serviceMomentX: 0, serviceMomentY: 0, factoredMomentX: 0, factoredMomentY: 0,
    safeBearingCapacity: 200, concreteGrade: 'M25', steelGrade: 'Fe415', includeFootingSelfWeight: true,
    result: { designType: 'Footing' }
  } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['content-disposition'], /footing-report\.pdf/);
  assert.equal(res.body.subarray(0, 4).toString('latin1'), '%PDF');
  assert.equal(/undefined|NaN|Infinity/.test(res.body.toString('latin1')), false);
});
