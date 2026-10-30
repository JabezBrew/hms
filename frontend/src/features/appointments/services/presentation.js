// Display labels never replace authoritative strings in commands or receipts.
export const serviceName = service => service.name.trim() ? service.name : `Unnamed legacy service (${service.id.slice(-8)})`;
export const serviceCode = service => service.code.trim() ? service.code : 'Code not recorded';
