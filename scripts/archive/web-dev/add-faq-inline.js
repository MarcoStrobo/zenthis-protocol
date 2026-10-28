const fs = require("fs");
let c = fs.readFileSync("C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html", "utf8");

const faqJS =
  "\n  <script>\n" +
  "    // FAQ accordion (inline, cache-proof)\n" +
  "    try {\n" +
  "      document.querySelectorAll('.faq-question').forEach(function(btn) {\n" +
  "        btn.addEventListener('click', function() {\n" +
  "          var answer = btn.nextElementSibling;\n" +
  "          var isOpen = btn.classList.contains('open');\n" +
  "          document.querySelectorAll('.faq-question.open').forEach(function(other) {\n" +
  "            if (other !== btn) { other.classList.remove('open'); other.nextElementSibling.classList.remove('open'); }\n" +
  "          });\n" +
  "          btn.classList.toggle('open', !isOpen);\n" +
  "          answer.classList.toggle('open', !isOpen);\n" +
  "        });\n" +
  "      });\n" +
  "    } catch(e) {}\n" +
  "  </script>\n";

const insertPoint = c.lastIndexOf("</script>", c.lastIndexOf("</body>"));
c = c.substring(0, insertPoint + 9) + faqJS + c.substring(insertPoint + 9);

fs.writeFileSync("C:\\Users\\Suko\\Documents\\zenthis-protocol\\web\\index.html", c, "utf8");
console.log("Inline FAQ accordion added successfully");
