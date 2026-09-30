from PIL import Image, ImageDraw

def render_logo(size: int) -> Image.Image:
    # Render at 4x resolution for smooth supersampling antialiasing
    scale = 4
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Base coordinates on 32x32 grid
    def s(val):
        return int(val * (canvas_size / 32.0))

    # Emerald background rounded rect
    draw.rounded_rectangle(
        [s(0), s(0), s(32), s(32)],
        radius=s(7),
        fill=(5, 150, 105, 255) # emerald-600
    )

    # Back document sheet (semi-transparent white)
    draw.rounded_rectangle(
        [s(7), s(6), s(21), s(23)],
        radius=s(2),
        fill=(255, 255, 255, 115)
    )

    # Front document sheet (solid white)
    draw.rounded_rectangle(
        [s(11), s(9), s(25), s(26)],
        radius=s(2),
        fill=(255, 255, 255, 255)
    )

    # Content lines on front sheet
    # Line 1
    draw.rounded_rectangle(
        [s(14), s(13), s(22), s(15)],
        radius=max(1, s(1)),
        fill=(4, 120, 87, 255) # emerald-700
    )
    # Line 2
    draw.rounded_rectangle(
        [s(14), s(17), s(20), s(19)],
        radius=max(1, s(1)),
        fill=(4, 120, 87, 255)
    )
    # Line 3
    draw.rounded_rectangle(
        [s(14), s(21), s(18), s(23)],
        radius=max(1, s(1)),
        fill=(4, 120, 87, 255)
    )

    # Downsample with Lanczos for crisp antialiasing
    return img.resize((size, size), Image.Resampling.LANCZOS)

if __name__ == "__main__":
    # Generate multi-size .ico
    sizes = [16, 32, 48, 64]
    images = [render_logo(sz) for sz in sizes]

    # Save app/favicon.ico
    images[0].save(
        "app/favicon.ico",
        format="ICO",
        sizes=[(sz, sz) for sz in sizes],
        append_images=images[1:]
    )
    print("Saved app/favicon.ico")

    # Also save public/favicon.ico
    images[0].save(
        "public/favicon.ico",
        format="ICO",
        sizes=[(sz, sz) for sz in sizes],
        append_images=images[1:]
    )
    print("Saved public/favicon.ico")

    # Generate 180x180 apple-icon.png
    apple_icon = render_logo(180)
    apple_icon.save("app/apple-icon.png", format="PNG")
    print("Saved app/apple-icon.png")
