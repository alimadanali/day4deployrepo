import ExcelJS from 'exceljs';

// Excel runs text starting with these as a formula; a leading ' keeps it plain text.
const safeText = (v) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v);

const width = (header, values) =>
  Math.min(50, Math.max(10, header.length + 2, ...values.map((v) => String(v ?? '').length + 2)));

export function buildCustomersWorkbook(customers) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Customers', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = [
    { header: 'ID', key: 'id', get: (c) => c.customer_id },
    { header: 'Name', key: 'name', get: (c) => safeText(c.customer_name) },
    { header: 'Email', key: 'email', get: (c) => safeText(c.email) },
    { header: 'Created', key: 'created', get: (c) => (c.created_at ? new Date(c.created_at) : null) },
  ];
  sheet.columns = cols.map(({ header, key }) => ({
    header,
    key,
    width: width(header, customers.map((c) => cols.find((x) => x.key === key).get(c))),
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn('created').numFmt = 'yyyy-mm-dd hh:mm';
  for (const c of customers) sheet.addRow(Object.fromEntries(cols.map((x) => [x.key, x.get(c)])));
  return workbook;
}
