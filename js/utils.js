// دوال مساعدة

const Utils = {
  // تقريب الرقم إلى رقمين بعد الفاصلة
  roundToTwoDecimals: (num) => {
    if (typeof num !== 'number' || isNaN(num)) return 0;
    return parseFloat(num.toFixed(2));
  },
  
  // تنسيق العملة
  formatCurrency: (amount) => {
    return `${Utils.roundToTwoDecimals(amount)} ج.م`;
  },
  
  // تنسيق التاريخ بتوقيت مصر
  formatDate: (date) => {
    if (!date) return '—';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '—';
    const formatted = d.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Cairo'
    });
    return formatted;
  },

  // تنسيق الوقت فقط بتوقيت مصر
  formatTime: (date) => {
    if (!date) return '—';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Cairo'
    });
  },

  // تنسيق التاريخ فقط بتوقيت مصر
  formatDateOnly: (date) => {
    if (!date) return '—';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Africa/Cairo'
    });
  },
  
  // حساب إجمالي الطلب
  calculateOrderTotal: (items, taxRate = 0) => {
    const subtotal = items.reduce((sum, item) => {
      const itemPrice = (item.price || 0) * (item.quantity || 0);
      const itemDiscount = item.discount || 0;
      return sum + (itemPrice - itemDiscount);
    }, 0);
    
    const tax = subtotal * taxRate;
    const discount = items.reduce((sum, item) => sum + (item.discount || 0), 0);
    const total = subtotal + tax - discount;
    
    return {
      subtotal: Utils.roundToTwoDecimals(subtotal),
      tax: Utils.roundToTwoDecimals(tax),
      discount: Utils.roundToTwoDecimals(discount),
      total: Utils.roundToTwoDecimals(total)
    };
  },
  
  // طباعة الفاتورة
   printInvoice: (order) => {
     const _ss = JSON.parse(localStorage.getItem('storeSettings') || '{}');
     const _fs = JSON.parse(localStorage.getItem('settings') || '{}');
     const storeName    = localStorage.getItem('solo_store_name') || _fs.storeName || _ss.storeName || 'Solo POS';
     const storeAddress = _ss.address || _fs.address || localStorage.getItem('solo_user_address') || '';
     const _firstPhone  = _ss.phone   || _fs.phone   || localStorage.getItem('solo_user_phone')   || '';
     const _extraPhones = JSON.parse(localStorage.getItem('solo_user_extra_phones') || '[]');
     const allPhones    = [...new Set([_firstPhone, ..._extraPhones].filter(Boolean))];
     const totals = Utils.calculateOrderTotal(order.items); 
     
     const htmlContent = ` 
       <!DOCTYPE html> 
       <html dir="rtl" lang="ar"> 
       <head> 
         <meta charset="UTF-8"> 
         <title>فاتورة - ${order.id}</title> 
         <style> 
           @page { margin: 0; } 
           * { box-sizing: border-box; } 
           body { font-family: 'Cairo', sans-serif; width: 80mm; margin: 0 auto; padding: 4mm; color: #000; font-size: 13px; direction: rtl; } 
           .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 8px; } 
           .header h2 { margin: 0; font-size: 22px; font-weight: 800; } 
           .info { margin-bottom: 10px; border-bottom: 1px dashed #000; padding-bottom: 5px; font-size: 12px; } 
           .info-row { display: flex; justify-content: space-between; margin-bottom: 4px; } 
           
           .items-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; } 
           .items-table th { border-bottom: 1px solid #000; padding: 4px 0; text-align: right; font-size: 12px; } 
           
           /* 🛡️ السحر هنا: بيمنع قص الكلام العربي الطويل */ 
           .items-table td { padding: 6px 0; vertical-align: top; border-bottom: 1px dotted #ccc; } 
           .item-name-col { width: 60%; word-wrap: break-word; overflow-wrap: break-word; line-height: 1.4; padding-left: 5px; font-weight: 600; } 
           .item-qty-col { width: 15%; text-align: center; font-weight: bold; } 
           .item-price-col { width: 25%; text-align: left; font-weight: bold; } 
           
           .totals { padding-top: 5px; } 
           .total-row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px; font-weight: bold; } 
           .grand-total { font-size: 16px; margin-top: 5px; border-top: 2px dashed #000; padding-top: 5px; } 
           .footer { text-align: center; margin-top: 15px; font-size: 12px; font-weight: bold; border-top: 1px dashed #000; padding-top: 10px; } 
         </style> 
       </head> 
       <body> 
         <div class="header"> 
           <div class="store-name">${storeName}</div>
           ${storeAddress ? `<div class="store-address">${storeAddress}</div>` : ''}
           ${allPhones.map(p => `<div class="store-phone">Tel: ${p}</div>`).join('')}
         </div> 
         
         <div class="order-number">فاتورة رقم: ${order.id}</div> 
         
         <div class="info"> 
           <div class="info-item"><strong>التاريخ:</strong> ${Utils.formatDate(order.date || order.created_at || order.createdAt)}</div> 
           <div class="info-item"><strong>نوع الطلب:</strong> ${order.orderType === 'delivery' ? 'دليفري 🛵' : order.orderType === 'dinein' ? 'Dine In - الصالة 🍽️' : 'تيك أواي 🛍️'}</div> 
           ${order.tableNumber ? `<div class="info-item"><strong>رقم الطاولة:</strong> ${order.tableNumber}</div>` : ''} 
         </div> 
         
         ${order.orderType === 'delivery' && order.deliveryInfo ? `
         <div class="section" style="border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px;">
             <div class="title" style="text-align: center; font-weight: bold; background: #eee; padding: 4px; border-radius: 4px; margin-bottom: 5px;">بيانات التوصيل</div>
             <div class="row"><span>الاسم:</span> <span class="bold">${order.deliveryInfo.customerName || 'غير مسجل'}</span></div>
             <div class="row"><span>الهاتف:</span> <span class="bold" dir="ltr">${order.deliveryInfo.phone || ''}</span></div>
             <div class="row" style="white-space: normal;"><span>العنوان:</span> <span class="bold" style="white-space: pre-wrap;">${order.deliveryInfo.address || ''}</span></div>
         </div>
         ` : ''} 
         
         ${order.note ? `<div class="info-item" style="margin-top: 8px; border: 1px dashed #000; padding: 4px;"><strong>ملاحظة:</strong> ${order.note}</div>` : ''} 
         
         <div class="separator"></div> 
         
         <table class="items-table">
           <thead>
             <tr>
               <th class="item-name-col">الصنف</th>
               <th class="item-qty-col">الكمية</th>
               <th class="item-price-col">الإجمالي</th>
             </tr>
           </thead>
           <tbody>
             ${order.items.map(item => `
               <tr>
                 <td class="item-name-col">${item.name}${item.variant ? `<br><small>(${item.variant})</small>` : ''}</td>
                 <td class="item-qty-col">${item.quantity}</td>
                 <td class="item-price-col">${Utils.formatCurrency(item.price * item.quantity)}</td>
               </tr>
             `).join('')}
           </tbody>
         </table> 
         
         <div class="separator"></div> 
         
         <div class="totals-section"> 
           <div class="total-row"> 
             <div class="total-label">المبيعات الصافية:</div> 
             <div class="total-value">${Utils.formatCurrency(order.originalSubtotal || order.subtotal || totals.subtotal)}</div> 
           </div> 
           ${order.discount && parseFloat(order.discount) > 0 ? ` 
           <div class="total-row" style="font-weight: bold; color: #555;"> 
             <div class="total-label">الخصم:</div> 
             <div class="total-value">-${Utils.formatCurrency(order.discount)}</div> 
           </div> 
           ` : ''} 
           ${order.tax && parseFloat(order.tax) > 0 ? `
           <div class="total-row">
             <div class="total-label">ضريبة القيمة المضافة:</div>
             <div class="total-value">+${Utils.formatCurrency(order.tax)}</div>
           </div>
           ` : ''}
           ${order.serviceCharge && parseFloat(order.serviceCharge) > 0 ? `
           <div class="total-row">
             <div class="total-label">رسوم الخدمة:</div>
             <div class="total-value">+${Utils.formatCurrency(order.serviceCharge)}</div>
           </div>
           ` : ''}
           ${order.deliveryFee && parseFloat(order.deliveryFee) > 0 ? `
           <div class="total-row">
             <div class="total-label">سعر التوصيل:</div>
             <div class="total-value">+${Utils.formatCurrency(order.deliveryFee)}</div>
           </div>
           ` : ''}

           <div class="total-row grand-total">
             <div class="total-label">الإجمالي الكلي:</div>
             <div class="total-value">${Utils.formatCurrency(order.total || totals.total)}</div>
           </div> 
         </div> 
         
         <div class="footer">
           <p>شكراً لزيارتكم ${storeName}!</p>
         </div> 
       </body> 
       </html> 
     `; 
     
     if (typeof require !== 'undefined') { 
         const { ipcRenderer } = require('electron'); 
         ipcRenderer.send('print-receipt-hidden', htmlContent); 
     } else { 
         const printWindow = window.open('', '_blank'); 
         printWindow.document.write(htmlContent); 
         printWindow.document.close(); 
         setTimeout(() => printWindow.print(), 250); 
     } 
   },

  // تحديث معلومات المتجر في الواجهة (بشكل فوري ومتزامن)
  updateStoreInfo: () => {
    const storeName = "مطعم ريان";
    document.title = storeName;
    const headerTitleEl = document.querySelector('.header-title');
    if (headerTitleEl) {
        headerTitleEl.textContent = storeName;
    }
  }
};