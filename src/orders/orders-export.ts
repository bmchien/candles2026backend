import ExcelJS from 'exceljs';
import { toBusinessWallClock } from '../common/utils/business-date';
import { AdminOrderWithItems } from './order.mapper';
import { ORDER_STATUS_LABELS } from './order-status';

/** Upper bound for one export, to keep memory bounded. */
export const MAX_EXPORT_ORDERS = 10_000;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MONEY_FORMAT = '#,##0" ₫"';
const DATE_TIME_FORMAT = 'dd/mm/yyyy hh:mm';
const DATE_FORMAT = 'dd/mm/yyyy';

const SHIPPING_LABELS = { PICKUP: 'Nhận tại cửa hàng', DELIVERY: 'Giao tận nhà' } as const;

export const orderCode = (id: bigint) => `#${id.toString().padStart(6, '0')}`;

function address(o: AdminOrderWithItems): string {
  if (o.shippingMethod === 'PICKUP') return 'Nhận tại cửa hàng';
  return [o.detailAddress, o.wardName, o.provinceName].filter(Boolean).join(', ');
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF446B55' } };
  header.alignment = { vertical: 'middle' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
}

/**
 * Builds the .xlsx export: sheet 1 has one row per order, sheet 2 one row per order line.
 * Timestamps are written as Vietnam wall-clock time; money values are numbers (VND).
 */
export async function buildOrdersWorkbook(orders: AdminOrderWithItems[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Chipscendle';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Đơn hàng');
  sheet.columns = [
    { header: 'Mã đơn', key: 'code', width: 11 },
    { header: 'Ngày đặt', key: 'createdAt', width: 17, style: { numFmt: DATE_TIME_FORMAT } },
    {
      header: 'Ngày nhận mong muốn',
      key: 'desiredDate',
      width: 20,
      style: { numFmt: DATE_FORMAT },
    },
    { header: 'Trạng thái', key: 'status', width: 15 },
    { header: 'Khách hàng', key: 'customer', width: 24 },
    { header: 'Số điện thoại', key: 'phone', width: 14 },
    { header: 'Email tài khoản', key: 'email', width: 28 },
    { header: 'Hình thức nhận', key: 'shipping', width: 18 },
    { header: 'Địa chỉ', key: 'address', width: 45 },
    { header: 'Sản phẩm', key: 'products', width: 50 },
    { header: 'Số lượng', key: 'quantity', width: 10 },
    { header: 'Tổng tiền', key: 'total', width: 16, style: { numFmt: MONEY_FORMAT } },
  ];

  const lines = workbook.addWorksheet('Chi tiết sản phẩm');
  lines.columns = [
    { header: 'Mã đơn', key: 'code', width: 11 },
    { header: 'Ngày đặt', key: 'createdAt', width: 17, style: { numFmt: DATE_TIME_FORMAT } },
    { header: 'Trạng thái', key: 'status', width: 15 },
    { header: 'Mã sản phẩm', key: 'productCode', width: 22 },
    { header: 'Tên sản phẩm', key: 'productName', width: 40 },
    { header: 'Đơn giá', key: 'price', width: 15, style: { numFmt: MONEY_FORMAT } },
    { header: 'Số lượng', key: 'quantity', width: 10 },
    { header: 'Thành tiền', key: 'subtotal', width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: 'Ghi chú', key: 'note', width: 40 },
  ];

  let grandTotal = 0;
  for (const o of orders) {
    const code = orderCode(o.id);
    const createdAt = toBusinessWallClock(o.createdAt);
    const status = ORDER_STATUS_LABELS[o.status];
    const total = o.totalAmount.toNumber();
    grandTotal += o.status === 'CANCELLED' ? 0 : total;
    sheet.addRow({
      code,
      createdAt,
      desiredDate: o.desiredDate ?? null,
      status,
      customer: o.customerName,
      phone: o.customerPhone,
      email: o.user.email,
      shipping: SHIPPING_LABELS[o.shippingMethod],
      address: address(o),
      products: o.items
        .map((i) => `${i.productName} × ${i.quantity}${i.note ? ` (ghi chú: ${i.note})` : ''}`)
        .join('; '),
      quantity: o.items.reduce((n, i) => n + i.quantity, 0),
      total,
    });
    for (const i of o.items) {
      lines.addRow({
        code,
        createdAt,
        status,
        productCode: i.productCode,
        productName: i.productName,
        price: i.price.toNumber(),
        quantity: i.quantity,
        subtotal: i.subtotal.toNumber(),
        note: i.note ?? '',
      });
    }
  }

  styleHeader(sheet);
  styleHeader(lines);
  sheet.addRow([]);
  const totalRow = sheet.addRow({
    products: `Tổng ${orders.length} đơn (không tính đơn huỷ)`,
    total: grandTotal,
  });
  totalRow.font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
