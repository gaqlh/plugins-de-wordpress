Vilma Supplier Compare (Modules) – Purchase Orders Addon (V1)
Estructura modular:

/vilma-supplier-compare-purchase-orders.php  -> bootstrap (plugin header + carga de módulos)
/includes/traits/trait-*.php                 -> módulos PHP (sin cambiar lógica)
/assets/po.js                                -> frontend
/assets/po.css                               -> estilos

Nota: Se añadió la constante VSC_PO_ADDON_FILE para que plugins_url apunte al archivo principal.
