# توصيل نوفا — نسخة Full Stack

## ماذا تحتوي؟
- API حقيقي بـ Node.js + Express.
- SQLite لبيانات المستخدمين والمتاجر والسلع والطلبات.
- JWT لتسجيل الدخول.
- أدوار: عميل / متجر / مندوب / مدير.
- إنشاء وإدارة المتاجر والسلع.
- إنشاء الطلبات وتحديث حالتها.
- إسناد الطلب إلى مندوب.
- موقع العميل والمندوب داخل الطلب.
- Socket.IO لتحديث حالة الطلب والموقع بشكل فوري.
- واجهة PWA عربية RTL.
- مشروع Capacitor جاهز لفتح التطبيق كـ Android.

## التشغيل
1. ثبّت Node.js 20+.
2. من مجلد server:
   npm install
   npm start
3. افتح:
   http://localhost:3000

حساب مدير تجريبي:
admin@nova.local
Nova@12345

## تشغيل Android
بعد تشغيل/استضافة الـAPI، عدّل `web/app.js` واجعل API_BASE عنوان السيرفر العام، ثم:
npm install
npx cap add android
npx cap sync android
npx cap open android

ملاحظة: ملف APK النهائي يحتاج Android SDK/Android Studio وبيئة بناء Android. المشروع هنا مجهز لذلك، لكن لا يمكن إنشاء توقيع متجر Google Play أو استضافة سيرفر عام من داخل المحادثة نفسها.
