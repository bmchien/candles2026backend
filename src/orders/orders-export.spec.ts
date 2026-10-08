import { OrderStatus, Prisma, Role, ShippingMethod } from '@prisma/client';
import ExcelJS from 'exceljs';
import { AdminOrderWithItems } from './order.mapper';
import { buildOrdersWorkbook } from './orders-export';

const D = (v: number) => new Prisma.Decimal(v);

function order(
  id: bigint,
  status: OrderStatus,
  shippingMethod: ShippingMethod,
  total: number,
): AdminOrderWithItems {
  return {
    id,
    userId: 1n,
    shippingMethod,
    customerName: 'Nguyễn Văn An',
    customerPhone: '0912345678',
    provinceCode: shippingMethod === 'DELIVERY' ? '1' : null,
    provinceName: shippingMethod === 'DELIVERY' ? 'Thành phố Hà Nội' : null,
    wardCode: shippingMethod === 'DELIVERY' ? '4' : null,
    wardName: shippingMethod === 'DELIVERY' ? 'Phường Ba Đình' : null,
    detailAddress: shippingMethod === 'DELIVERY' ? '12 Kim Mã' : null,
    desiredDate: new Date('2026-10-20T00:00:00Z'),
    totalAmount: D(total),
    status,
    // 2026-10-06 18:30 UTC = 2026-10-07 01:30 in Vietnam
    createdAt: new Date('2026-10-06T18:30:00Z'),
    updatedAt: new Date('2026-10-06T18:30:00Z'),
    user: { id: 1n, name: 'An', email: 'an@example.com', role: Role.CUSTOMER },
    items: [
      {
        id: id * 10n,
        orderId: id,
        productId: 5n,
        productName: 'Nến thơm Vườn nhà',
        productCode: 'HOM-037',
        price: D(total / 2),
        quantity: 2,
        subtotal: D(total),
        product: null,
      },
    ],
  };
}

/** Cell value by header text (column keys are not stored in the file). */
function cell(sheet: ExcelJS.Worksheet, row: number, header: string): ExcelJS.CellValue {
  const headers = sheet.getRow(1).values as ExcelJS.CellValue[];
  const col = headers.indexOf(header);
  if (col < 1) throw new Error(`No column "${header}"`);
  return sheet.getRow(row).getCell(col).value;
}

describe('buildOrdersWorkbook', () => {
  it('writes one row per order and one row per line, with Vietnamese labels and VN time', async () => {
    const buffer = await buildOrdersWorkbook([
      order(12n, OrderStatus.AWAITING_DEPOSIT, ShippingMethod.DELIVERY, 560_000),
      order(13n, OrderStatus.CANCELLED, ShippingMethod.PICKUP, 100_000),
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    const orders = wb.getWorksheet('Đơn hàng')!;
    expect(orders.getRow(1).values).toEqual(
      expect.arrayContaining(['Mã đơn', 'Ngày nhận mong muốn', 'Trạng thái', 'Tổng tiền']),
    );
    expect(cell(orders, 2, 'Mã đơn')).toBe('#000012');
    expect((cell(orders, 2, 'Ngày đặt') as Date).toISOString()).toBe('2026-10-07T01:30:00.000Z');
    expect((cell(orders, 2, 'Ngày nhận mong muốn') as Date).toISOString().slice(0, 10)).toBe(
      '2026-10-20',
    );
    expect(cell(orders, 2, 'Trạng thái')).toBe('Chờ cọc');
    expect(cell(orders, 2, 'Địa chỉ')).toBe('12 Kim Mã, Phường Ba Đình, Thành phố Hà Nội');
    expect(cell(orders, 2, 'Sản phẩm')).toBe('Nến thơm Vườn nhà × 2');
    expect(cell(orders, 2, 'Tổng tiền')).toBe(560_000);
    expect(cell(orders, 3, 'Trạng thái')).toBe('Huỷ');
    expect(cell(orders, 3, 'Địa chỉ')).toBe('Nhận tại cửa hàng');

    // Total row excludes cancelled orders
    expect(cell(orders, 5, 'Tổng tiền')).toBe(560_000);

    const lines = wb.getWorksheet('Chi tiết sản phẩm')!;
    expect(lines.rowCount).toBe(3);
    expect(cell(lines, 2, 'Mã sản phẩm')).toBe('HOM-037');
    expect(cell(lines, 2, 'Thành tiền')).toBe(560_000);
  });

  it('produces a valid workbook for an empty result', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildOrdersWorkbook([]));
    expect(wb.getWorksheet('Đơn hàng')!.getRow(1).getCell(1).value).toBe('Mã đơn');
  });
});
