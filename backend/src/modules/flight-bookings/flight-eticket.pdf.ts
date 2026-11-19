import PDFDocument from 'pdfkit';
import { join } from 'node:path';

export interface FlightTicketData {
  reference: string;
  totalAmountMinor: number;
  currency: string;
  segments: {
    airline: string;
    number: string;
    from: string;
    to: string;
    departure: string;
    arrival: string;
    cabin: string;
    seats: number;
    bags: string;
  }[];
  passengers: {
    name: string;
    type: string;
    extraBags: number;
    weights: number[];
  }[];
}

/** Render only the positive ticket projection. Never fetch remote logos or other URLs. */
export async function renderFlightTicket(
  ticket: FlightTicketData,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 44,
    bufferPages: true,
    info: {
      Title: 'GIU Travel e-ticket ' + ticket.reference,
      Author: 'GIU Travel',
      Subject: 'Confirmed flight booking',
    },
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const fonts = join(__dirname, '../../assets/fonts');
  doc.registerFont('body', join(fonts, 'NotoSans.ttf'));
  doc.registerFont('arabic', join(fonts, 'NotoSansArabic.ttf'));
  const left = 44,
    width = doc.page.width - 88,
    ink = '#173044',
    muted = '#536979',
    teal = '#087C83';
  let y = 0;
  const clean = (value: string) =>
    value
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  function font(value: string, size = 10) {
    doc
      .font(
        /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(value)
          ? 'arabic'
          : 'body',
      )
      .fontSize(size);
  }
  function header() {
    doc.rect(0, 0, doc.page.width, 9).fill(teal);
    doc.font('body').fontSize(11).fillColor(teal).text('GIU TRAVEL', left, 35);
    doc.fontSize(25).fillColor(ink).text('Flight e-ticket', left, 56);
    doc
      .fontSize(10)
      .fillColor(muted)
      .text('Confirmed booking  |  Reference: ' + ticket.reference, left, 96, {
        width,
      });
    doc
      .moveTo(left, 122)
      .lineTo(left + width, 122)
      .strokeColor('#D4E2E8')
      .stroke();
    y = 139;
  }
  function space(height: number) {
    if (y + height > doc.page.height - 67) {
      doc.addPage();
      header();
    }
  }
  function text(value: string, size = 10, color = ink, indent = 0) {
    const valueClean = clean(value);
    font(valueClean, size);
    // PDFKit supports feature maps; its older @types declaration only lists arrays.
    // Shape whole lines and keep precomposed Arabic Unicode in the PDF text map.
    const options = {
      width: width - indent,
      lineGap: 3,
      features: { ccmp: false },
    } as unknown as PDFKit.Mixins.TextOptions;
    const height = doc.heightOfString(valueClean, options);
    space(height + 7);
    font(valueClean, size);
    doc.fillColor(color).text(valueClean, left + indent, y, options);
    y += height + 7;
  }
  function section(value: string) {
    space(55);
    y += 8;
    text(value, 13, teal);
  }
  try {
    header();
    section('Flight itinerary');
    for (const [index, segment] of ticket.segments.entries()) {
      space(155);
      text(
        (index === 0 ? 'Outbound' : 'Return') +
          '  |  ' +
          segment.number +
          '  |  ' +
          segment.airline,
        12,
      );
      text(segment.from + '  to  ' + segment.to, 11);
      text('Departure: ' + segment.departure, 9, muted);
      text('Arrival: ' + segment.arrival, 9, muted);
      text(
        'Cabin: ' + segment.cabin + '  |  Seats reserved: ' + segment.seats,
        10,
      );
      text(segment.bags, 9, muted);
      y += 5;
    }
    section('Passengers');
    for (const [index, passenger] of ticket.passengers.entries()) {
      space(85);
      text('Passenger ' + (index + 1) + '  |  ' + passenger.type, 9, muted);
      text(passenger.name, 12);
      text(
        'Extra bags: ' +
          passenger.extraBags +
          (passenger.weights.length
            ? '  |  Declared weights: ' + passenger.weights.join(', ') + ' kg'
            : ''),
        9,
        muted,
      );
      y += 5;
    }
    section('Payment summary');
    text(
      'Booking total: ' +
        ticket.currency +
        ' ' +
        Math.floor(ticket.totalAmountMinor / 100) +
        '.' +
        String(ticket.totalAmountMinor % 100).padStart(2, '0'),
      14,
    );
    text(
      'Airport-local times include the UTC offset and IANA time zone. This document records your confirmed booking; check your current itinerary before travel.',
      9,
      muted,
    );
    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index++) {
      doc.switchToPage(index);
      doc.page.margins.bottom = 0;
      doc
        .moveTo(left, doc.page.height - 48)
        .lineTo(left + width, doc.page.height - 48)
        .strokeColor('#D4E2E8')
        .stroke();
      doc
        .font('body')
        .fontSize(8)
        .fillColor(muted)
        .text(
          'GIU Travel  |  ' +
            ticket.reference +
            '  |  Page ' +
            (index + 1) +
            ' of ' +
            range.count,
          left,
          doc.page.height - 35,
          { width, lineBreak: false },
        );
    }
    doc.end();
  } catch (error) {
    doc.destroy(
      error instanceof Error ? error : new Error('Ticket rendering failed'),
    );
  }
  return result;
}
