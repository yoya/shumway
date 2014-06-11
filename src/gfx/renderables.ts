/**
 * Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/// <reference path='references.ts'/>
module Shumway.GFX {
  import Point = Geometry.Point;
  import Rectangle = Geometry.Rectangle;
  import PathCommand = Shumway.PathCommand;
  import Matrix = Geometry.Matrix;
  import DataBuffer = Shumway.ArrayUtilities.DataBuffer;
  import swap32 = Shumway.IntegerUtilities.swap32;
  import memorySizeToString = Shumway.StringUtilities.memorySizeToString;
  import assertUnreachable = Shumway.Debug.assertUnreachable;
  import unpremultiplyARGB = Shumway.ColorUtilities.unpremultiplyARGB;
  import tableLookupUnpremultiplyARGB = Shumway.ColorUtilities.tableLookupUnpremultiplyARGB;
  import assert = Shumway.Debug.assert;
  import notImplemented = Shumway.Debug.notImplemented;

  export enum RenderableFlags {
    None          = 0,

    /**
     * Whether source has dynamic content.
     */
    Dynamic       = 1,

    /**
     * Whether the source's dynamic content has changed. This is only defined if |isDynamic| is true.
     */
    Dirty         = 2,

    /**
     * Whether the source's content can be scaled and drawn at a higher resolution.
     */
    Scalable      = 4,

    /**
     * Whether the source's content should be tiled.
     */
    Tileable      = 8
  }

  /**
   * Represents some source renderable content.
   */
  export class Renderable {
    /**
     * Flags
     */
    _flags: RenderableFlags = RenderableFlags.None;

    setFlags(flags: RenderableFlags) {
      this._flags |= flags;
    }

    hasFlags(flags: RenderableFlags): boolean {
      return (this._flags & flags) === flags;
    }

    removeFlags(flags: RenderableFlags) {
      this._flags &= ~flags;
    }

    /**
     * Property bag used to attach dynamic properties to this object.
     */
    properties: {[name: string]: any} = {};

    _bounds: Rectangle;

    constructor(bounds: Rectangle) {
      this._bounds = bounds.clone();
    }

    /**
     * Bounds of the source content. This should never change.
     */
    getBounds (): Rectangle {
      return this._bounds;
    }

    /**
     * Render source content in the specified |context|. If specified, the rectangular |cullBounds| can be used to cull parts of the shape
     * for better performance. If specified, |clipRegion| indicates whether the shape's fills should be used as clip regions instead.
     */
    render(context: CanvasRenderingContext2D, cullBounds?: Shumway.GFX.Geometry.Rectangle, clipRegion?: boolean): void {

    }
  }

  export class CustomRenderable extends Renderable {
    constructor(bounds: Rectangle, render: (context: CanvasRenderingContext2D, cullBounds: Shumway.GFX.Geometry.Rectangle) => void) {
      super(bounds);
      this.render = render;
    }
  }

  export class RenderableBitmap extends Renderable {
    _flags = RenderableFlags.Dynamic | RenderableFlags.Dirty;
    properties: {[name: string]: any} = {};
    _canvas: HTMLCanvasElement;
    private fillStyle: ColorStyle;

    private static _convertImage(sourceFormat: ImageType, targetFormat: ImageType, source: Int32Array, target: Int32Array) {
      if (source !== target) {
        release || assert (source.buffer !== target.buffer, "Can't handle overlapping views.");
      }
      if (sourceFormat === targetFormat) {
        if (source === target) {
          return;
        }
        var length = source.length;
        for (var i = 0; i < length; i++) {
          target[i] = source[i];
        }
        return;
      }
      var timelineDetails = "convertImage: " + ImageType[sourceFormat] + " to " + ImageType[targetFormat] + " (" + memorySizeToString(source.length) + ")";
      enterTimeline(timelineDetails);

      if (sourceFormat === ImageType.PremultipliedAlphaARGB &&
          targetFormat === ImageType.StraightAlphaRGBA) {
        Shumway.ColorUtilities.ensureUnpremultiplyTable();
        var length = source.length;
        for (var i = 0; i < length; i++) {
          var pARGB = swap32(source[i]);
          // TODO: Make sure this is inlined!
          var uARGB = tableLookupUnpremultiplyARGB(pARGB);
          var uABGR = (uARGB & 0xFF00FF00)  | // A_G_
                      (uARGB >> 16) & 0xff  | // A_GR
                      (uARGB & 0xff) << 16;   // ABGR
          target[i] = uABGR;
        }
      } else if (sourceFormat === ImageType.StraightAlphaARGB &&
                 targetFormat === ImageType.StraightAlphaRGBA) {
        for (var i = 0; i < length; i++) {
          target[i] = swap32(source[i]);
        }
      } else {
        notImplemented("Image Format Conversion: " + ImageType[sourceFormat] + " -> " + ImageType[targetFormat]);
      }
      leaveTimeline(timelineDetails);
    }

    public static FromDataBuffer(type: ImageType, dataBuffer: DataBuffer, bounds: Rectangle): RenderableBitmap {
      enterTimeline("RenderableBitmap.FromDataBuffer");
      var canvas = document.createElement("canvas");
      canvas.width = bounds.w;
      canvas.height = bounds.h;
      var renderableBitmap = new RenderableBitmap(canvas, bounds);
      renderableBitmap.updateFromDataBuffer(type, dataBuffer);
      leaveTimeline("RenderableBitmap.FromDataBuffer");
      return renderableBitmap;
    }

    public updateFromDataBuffer(type: ImageType, dataBuffer: DataBuffer) {
      enterTimeline("RenderableBitmap.updateFromDataBuffer");

      var context = this._canvas.getContext("2d");

      if (type === ImageType.JPEG ||
          type === ImageType.PNG ||
          type === ImageType.GIF)
      {
        var img = new Image();
        img.src = URL.createObjectURL(dataBuffer.toBlob());
        img.onload = function () {
          context.drawImage(img, 0, 0);
        };
        img.onerror = function () {
          throw "img error";
        };
      } else {
        var imageData: ImageData = context.createImageData(this._bounds.w, this._bounds.h);

        RenderableBitmap._convertImage (
          type,
          ImageType.StraightAlphaRGBA,
          new Int32Array(dataBuffer.buffer),
          new Int32Array(imageData.data.buffer)
        );

        enterTimeline("putImageData");
        context.putImageData(imageData, 0, 0);
        leaveTimeline("putImageData");
      }

      this.setFlags(RenderableFlags.Dirty);
      leaveTimeline("RenderableBitmap.updateFromDataBuffer");
    }

    constructor(canvas: HTMLCanvasElement, bounds: Rectangle) {
      super(bounds);
      this._canvas = canvas;
    }

    render(context: CanvasRenderingContext2D, cullBounds: Rectangle): void {
      context.save();
      if (this._canvas) {
        context.drawImage(this._canvas, 0, 0);
      } else {
        this._renderFallback(context);
      }
      context.restore();
    }

    draw(source: RenderableBitmap, matrix: Shumway.GFX.Geometry.Matrix, colorMatrix: Shumway.GFX.ColorMatrix, blendMode: number, clipRect: Rectangle): void {
      var context = this._canvas.getContext('2d');
      context.save();
      if (clipRect) {
        context.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
        context.clip();
      }
      var bounds = source.getBounds();
      if (bounds.x || bounds.y) {
        matrix.translate(bounds.x, bounds.y);
      }
      if (matrix) {
        context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty);
      }
      context.drawImage(source._canvas, 0, 0);
      context.restore();
    }

    private _renderFallback(context: CanvasRenderingContext2D) {
      if (!this.fillStyle) {
        this.fillStyle = Shumway.ColorStyle.randomStyle();
      }
      var bounds = this._bounds;
      context.save();
      context.beginPath();
      context.lineWidth = 2;
      context.fillStyle = this.fillStyle;
      context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      context.restore();
    }
  }

  export class RenderableShape extends Renderable {
    _flags: RenderableFlags = RenderableFlags.Dirty | RenderableFlags.Scalable |
                              RenderableFlags.Tileable;
    properties: {[name: string]: any} = {};

    private _id: number;
    private fillStyle: ColorStyle;
    private _pathData: ShapeData;
    private _textures: RenderableBitmap[];

    private static LINE_CAP_STYLES = ['round', 'butt', 'square'];
    private static LINE_JOINT_STYLES = ['round', 'bevel', 'miter'];

    constructor(id: number, pathData: ShapeData, textures: RenderableBitmap[], bounds: Rectangle) {
      super(bounds);
      this._id = id;
      this._pathData = pathData;
      this._textures = textures;
    }

    getBounds(): Shumway.GFX.Geometry.Rectangle {
      return this._bounds;
    }

    /**
     * If |clipRegion| is |true| then we must call |clip| instead of |fill|. We also cannot call |save| or |restore|
     * because those functions reset the current clipping region. It looks like Flash ignores strokes when clipping
     * so we can also ignore stroke paths when computing the clip region.
     */
    render(context: CanvasRenderingContext2D, cullBounds: Rectangle, clipRegion: boolean = false): void {
      context.fillStyle = context.strokeStyle = 'transparent';

      var data = this._pathData;
      if (!data || data.commandsPosition === 0) {
        this._renderFallback(context);
        return;
      }
      enterTimeline("RenderableShape.render");
      // TODO: Optimize path handling to use only one path if possible.
      // If both line and fill style are set at the same time, we don't need to duplicate the
      // geometry.
      // TODO: cache Path2D and style objects.
      // We really only need to process the shape data once, and can then cache the results and
      // discard the original buffer. That should vastly improve performance of subsequent
      // renderings of the same shape.
      // TODO: correctly handle style changes.
      // Flash allows switching line and fill styles at arbitrary points, so you can have a
      // shape with a single fill but varying line styles. We support that, but don't yet
      // delay stroking of the lines until the fill is finished. Probably by pushing all
      // stroke paths onto a stack.
      var fillPath: Path2D = null;
      var strokePath: Path2D = null;
      // We have to alway store the last position because Flash keeps the drawing cursor where it
      // was when changing fill or line style, whereas Canvas forgets it on beginning a new path.
      var x = 0;
      var y = 0;
      var cpX: number;
      var cpY: number;
      var formOpen = false;
      var formOpenX = 0;
      var formOpenY = 0;
      var commands = data.commands;
      var coordinates = data.coordinates;
      var styles = data.styles;
      styles.position = 0;
      var coordinatesIndex = 0;
      var commandsCount = data.commandsPosition;
      // Description of serialization format can be found in flash.display.Graphics.
      for (var commandIndex = 0; commandIndex < commandsCount; commandIndex++) {
        var command = commands[commandIndex];
        switch (command) {
          case PathCommand.MoveTo:
            assert(coordinatesIndex <= data.coordinatesPosition - 2);
            if (formOpen && fillPath) {
              fillPath.lineTo(formOpenX, formOpenY);
              strokePath && strokePath.lineTo(formOpenX, formOpenY);
            }
            formOpen = true;
            x = formOpenX = coordinates[coordinatesIndex++] / 20;
            y = formOpenY = coordinates[coordinatesIndex++] / 20;
            fillPath && fillPath.moveTo(x, y);
            strokePath && strokePath.moveTo(x, y);
            break;
          case PathCommand.LineTo:
            assert(coordinatesIndex <= data.coordinatesPosition - 2);
            x = coordinates[coordinatesIndex++] / 20;
            y = coordinates[coordinatesIndex++] / 20;
            fillPath && fillPath.lineTo(x, y);
            strokePath && strokePath.lineTo(x, y);
            break;
          case PathCommand.CurveTo:
            assert(coordinatesIndex <= data.coordinatesPosition - 4);
            cpX = coordinates[coordinatesIndex++] / 20;
            cpY = coordinates[coordinatesIndex++] / 20;
            x = coordinates[coordinatesIndex++] / 20;
            y = coordinates[coordinatesIndex++] / 20;
            fillPath && fillPath.quadraticCurveTo(cpX, cpY, x, y);
            strokePath && strokePath.quadraticCurveTo(cpX, cpY, x, y);
            break;
          case PathCommand.CubicCurveTo:
            assert(coordinatesIndex <= data.coordinatesPosition - 6);
            cpX = coordinates[coordinatesIndex++] / 20;
            cpY = coordinates[coordinatesIndex++] / 20;
            var cpX2 = coordinates[coordinatesIndex++] / 20;
            var cpY2 = coordinates[coordinatesIndex++] / 20;
            x = coordinates[coordinatesIndex++] / 20;
            y = coordinates[coordinatesIndex++] / 20;
            fillPath && fillPath.bezierCurveTo(cpX, cpY, cpX2, cpY2, x, y);
            strokePath && strokePath.bezierCurveTo(cpX, cpY, cpX2, cpY2, x, y);
            break;
          case PathCommand.BeginSolidFill:
            assert(styles.bytesAvailable >= 4);
            fillPath = this._applyFill(context, fillPath, clipRegion, true, x, y);
            context.fillStyle = ColorUtilities.rgbaToCSSStyle(styles.readUnsignedInt());
            break;
          case PathCommand.BeginBitmapFill:
            fillPath = this._applyFill(context, fillPath, clipRegion, true, x, y);
            context.fillStyle = this._readBitmap(styles, context);
            break;
          case PathCommand.BeginGradientFill:
            fillPath = this._applyFill(context, fillPath, clipRegion, true, x, y);
            context.fillStyle = this._readGradient(styles, context);
            break;
          case PathCommand.EndFill:
            fillPath = this._applyFill(context, fillPath, clipRegion, false, 0, 0);
            context.fillStyle = null;
            break;
          case PathCommand.LineStyleSolid:
            strokePath = this._applyStroke(context, strokePath, clipRegion, true, x, y);
            context.lineWidth = coordinates[coordinatesIndex++]/20;
            context.strokeStyle = ColorUtilities.rgbaToCSSStyle(styles.readUnsignedInt());
            // Skip pixel hinting and scale mode for now.
            styles.position += 2;
            context.lineCap = RenderableShape.LINE_CAP_STYLES[styles.readByte()];
            context.lineJoin = RenderableShape.LINE_JOINT_STYLES[styles.readByte()];
            context.miterLimit = styles.readByte();
            break;
          case PathCommand.LineStyleGradient:
            strokePath = this._applyStroke(context, strokePath, clipRegion, true, x, y);
            context.strokeStyle = this._readGradient(styles, context);
            break;
          case PathCommand.LineStyleBitmap:
            strokePath = this._applyStroke(context, strokePath, clipRegion, true, x, y);
            context.strokeStyle = this._readBitmap(styles, context);
            break;
          case PathCommand.LineEnd:
            strokePath = this._applyStroke(context, strokePath, clipRegion, false, 0, 0);
            break;
          default:
            assertUnreachable('Invalid command ' + command + ' encountered at index' +
                              commandIndex + ' of ' + commandsCount);
        }
      }
      assert(styles.bytesAvailable === 0);
      assert(commandIndex === commandsCount);
      assert(coordinatesIndex === data.coordinatesPosition);
      if (formOpen && fillPath) {
        fillPath.lineTo(formOpenX, formOpenY);
        strokePath && strokePath.lineTo(formOpenX, formOpenY);
      }
      this._applyFill(context, fillPath, clipRegion, false, 0, 0);
      context.fillStyle = null;
      this._applyStroke(context, strokePath, clipRegion, false, 0, 0);
      leaveTimeline("RenderableShape.render");
    }

    private _applyFill(context: CanvasRenderingContext2D, path: Path2D, clipRegion: boolean,
                       createNewPath: boolean, x: number, y: number): Path2D
    {
      if (path) {
        clipRegion ? context.clip(path, 'evenodd') : context.fill(path, 'evenodd');
      }

      if (createNewPath) {
        path = new Path2D();
        path.moveTo(x, y);
        return path;
      }
      return null;
    }

    // Special-cases 1px and 3px lines by moving the drawing position down/right by 0.5px.
    // Flash apparently does this to create sharp, non-aliased lines in the normal case of thin
    // lines drawn on round pixel values.
    // Our handling doesn't always create the same results: for drawing coordinates with
    // fractional values, Flash draws blurry lines. We do, too, but we still move the line
    // down/right. Flash does something slightly different, with the result that a line drawn
    // on coordinates slightly below round pixels (0.8, say) will be moved up/left.
    // Properly fixing this would probably have to happen in the rasterizer. Or when replaying
    // all the drawing commands, which seems expensive.
    private _applyStroke(context: CanvasRenderingContext2D, path: Path2D, clipRegion: boolean,
                         createNewPath: boolean, x: number, y: number): Path2D
    {
      if (clipRegion) {
        return null;
      }
      if (path) {
        var lineWidth = context.lineWidth;
        var isSpecialCaseWidth = lineWidth === 1 || lineWidth === 3;
        if (isSpecialCaseWidth) {
          context.translate(0.5, 0.5);
        }
        context.stroke(path);
        if (isSpecialCaseWidth) {
          context.translate(-0.5, -0.5);
        }
      }

      if (createNewPath) {
        path = new Path2D();
        path.moveTo(x, y);
        return path;
      }
      return null;
    }

    private _readMatrix(data: DataBuffer): Matrix {
      return new Matrix (
        data.readFloat(), data.readFloat(), data.readFloat(),
        data.readFloat(), data.readFloat(), data.readFloat()
      );
    }

    private _readGradient(styles: DataBuffer, context: CanvasRenderingContext2D): CanvasGradient {
      // Assert at least one color stop.
      assert(styles.bytesAvailable >= 1 + 1 + 6 * 4 /* matrix fields as floats */ +
                                      1 + 1 + 4 + 1 + 1);
      var gradientType = styles.readUnsignedByte();
      var focalPoint = styles.readShort() * 2 / 0xff;
      assert(focalPoint >= -1 && focalPoint <= 1);
      var transform = this._readMatrix(styles);
      // This effectively applies the matrix to the line the gradient is drawn along:
      var x1 = transform.tx - transform.a;
      var y1 = transform.ty - transform.b;
      var x2 = transform.tx + transform.a;
      var y2 = transform.ty + transform.b;

      var gradient = gradientType === GradientType.Linear ?
                     context.createLinearGradient(x1, y1, x2, y2) :
                     context.createRadialGradient(focalPoint, 0, 0, 0, 0, 1);
      var colorStopsCount = styles.readUnsignedByte();
      for (var i = 0; i < colorStopsCount; i++) {
        var ratio = styles.readUnsignedByte() / 0xff;
        var cssColor = ColorUtilities.rgbaToCSSStyle(styles.readUnsignedInt());
        gradient.addColorStop(ratio, cssColor);
      }

      // Skip spread and interpolation modes for now.
      styles.position += 2;

      return gradient;
    }

    private _readBitmap(styles: DataBuffer, context: CanvasRenderingContext2D): CanvasPattern {
      assert(styles.bytesAvailable >= 4 + 6 * 4 /* matrix fields as floats */ + 1 + 1);
      var textureIndex = styles.readUnsignedInt();
      var fillTransform: Matrix = this._readMatrix(styles);
      var repeat = styles.readBoolean() ? 'repeat' : 'no-repeat';
      var smooth = styles.readBoolean();
      var texture = this._textures[textureIndex];
      assert(texture._canvas);
      var fillStyle: CanvasPattern = context.createPattern(texture._canvas, repeat);
      fillStyle.setTransform(fillTransform.toSVGMatrix());
      // TODO: make it possible to set smoothing for fills but not strokes and vice-versa.
      context['mozImageSmoothingEnabled'] = context.msImageSmoothingEnabled =
                                            context['imageSmoothingEnabled'] = smooth;
      return fillStyle;
    }

    private _renderFallback(context: CanvasRenderingContext2D) {
      if (!this.fillStyle) {
        this.fillStyle = Shumway.ColorStyle.randomStyle();
      }
      var bounds = this._bounds;
      context.save();
      context.beginPath();
      context.lineWidth = 2;
      context.fillStyle = this.fillStyle;
      context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
//      context.textBaseline = "top";
//      context.fillStyle = "white";
//      context.fillText(String(id), bounds.x, bounds.y);
      context.restore();
    }

  }

  export class RenderableText extends Renderable {
    _flags = RenderableFlags.Dynamic | RenderableFlags.Dirty;
    properties: {[name: string]: any} = {};

    private _plainText: string;
    private _textRunData: DataBuffer;

    constructor(plainText: string, textRunData: DataBuffer, bounds: Rectangle) {
      super(bounds);
      this.update(plainText, textRunData, bounds);
    }

    update(plainText: string, textRunData: DataBuffer, bounds: Rectangle) {
      this._plainText = plainText;
      this._textRunData = textRunData;
      this._bounds = bounds;
    }

    getBounds(): Shumway.GFX.Geometry.Rectangle {
      return this._bounds;
    }

    render(context: CanvasRenderingContext2D, cullBounds: Rectangle):void {
      // TODO
    }
  }

  export class Label extends Renderable {
    _flags: RenderableFlags = RenderableFlags.Dynamic | RenderableFlags.Scalable;
    properties: {[name: string]: any} = {};
    private _text: string;

    get text (): string {
      return this._text;
    }

    set text (value: string) {
      this._text = value;
    }

    constructor(w: number, h: number) {
      super(new Rectangle(0, 0, w, h));
    }

    render (context: CanvasRenderingContext2D, cullBounds?: Rectangle) {
      context.save();
      context.textBaseline = "top";
      context.fillStyle = "white";
      context.fillText(this.text, 0, 0);
      context.restore();
    }
  }

  export class Grid extends Renderable {
    _flags: RenderableFlags = RenderableFlags.Dirty | RenderableFlags.Scalable | RenderableFlags.Tileable;
    properties: {[name: string]: any} = {};

    constructor() {
      super(Rectangle.createMaxI16());
    }

    render (context: CanvasRenderingContext2D, cullBounds?: Rectangle) {
      context.save();

      var gridBounds = cullBounds || this.getBounds();

      context.fillStyle = ColorStyle.VeryDark;
      context.fillRect(gridBounds.x, gridBounds.y, gridBounds.w, gridBounds.h);

      function gridPath(level) {
        var vStart = Math.floor(gridBounds.x / level) * level;
        var vEnd   = Math.ceil((gridBounds.x + gridBounds.w) / level) * level;

        for (var x = vStart; x < vEnd; x += level) {
          context.moveTo(x + 0.5, gridBounds.y);
          context.lineTo(x + 0.5, gridBounds.y + gridBounds.h);
        }

        var hStart = Math.floor(gridBounds.y / level) * level;
        var hEnd   = Math.ceil((gridBounds.y + gridBounds.h) / level) * level;

        for (var y = hStart; y < hEnd; y += level) {
          context.moveTo(gridBounds.x, y + 0.5);
          context.lineTo(gridBounds.x + gridBounds.w, y + 0.5);
        }
      }

      context.beginPath();
      gridPath(100);
      context.lineWidth = 1;
      context.strokeStyle = ColorStyle.Dark;
      context.stroke();

      context.beginPath();
      gridPath(500);
      context.lineWidth = 1;
      context.strokeStyle = ColorStyle.TabToolbar;
      context.stroke();

      context.beginPath();
      gridPath(1000);
      context.lineWidth = 3;
      context.strokeStyle = ColorStyle.Toolbars;
      context.stroke();

      var MAX = 1024 * 1024;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(-MAX, 0.5);
      context.lineTo(MAX , 0.5);
      context.moveTo(0.5, -MAX);
      context.lineTo(0.5, MAX);
      context.strokeStyle = ColorStyle.Orange;
      context.stroke();

      context.restore();
    }
  }
}
