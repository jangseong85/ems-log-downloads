import AppKit

let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)

image.lockFocus()
NSColor.clear.setFill()
NSRect(origin: .zero, size: size).fill()

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let attributes: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 118, weight: .heavy),
  .foregroundColor: NSColor.white,
  .paragraphStyle: paragraph,
  .kern: -3,
]

let wordmark = NSAttributedString(string: "EMS Log", attributes: attributes)
let textSize = wordmark.size()
let textRect = NSRect(
  x: 0,
  y: (size.height - textSize.height) / 2,
  width: size.width,
  height: textSize.height
)
wordmark.draw(in: textRect)
image.unlockFocus()

guard
  let tiff = image.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiff),
  let png = bitmap.representation(using: .png, properties: [:])
else {
  fatalError("Failed to render splash wordmark")
}

let output = URL(fileURLWithPath: "assets/system-splash-wordmark.png")
try png.write(to: output)
