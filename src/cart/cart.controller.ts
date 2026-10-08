import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalAuth } from '../common/decorators/public.decorator';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ApiErrors, ApiOkWrapped } from '../common/swagger/api-responses';
import { CartOwner, CurrentCartOwner, GuestCartOwner } from './cart-owner';
import { CartService } from './cart.service';
import {
  AddCartItemDto,
  CartResponseDto,
  MergeCartResponseDto,
  UpdateCartItemDto,
} from './dto/cart.dto';

const cartTokenHeader = ApiHeader({
  name: 'X-Cart-Token',
  required: false,
  description:
    'Guest cart token (returned once as `guest_token` by POST /cart/items). Ignored when a valid Bearer token is sent.',
});

/**
 * Works for logged-in customers (Bearer JWT → their own cart) and for guests
 * (X-Cart-Token → the guest cart). Checkout (POST /orders) still requires login.
 */
@ApiTags('Cart')
@ApiBearerAuth()
@cartTokenHeader
@ApiErrors(HttpStatus.UNAUTHORIZED)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @OptionalAuth()
  @ApiOperation({ summary: 'Get my cart (or the guest cart) with server-computed prices' })
  @ApiOkWrapped(CartResponseDto)
  get(@CurrentCartOwner() owner: CartOwner | null) {
    return this.cartService.getCart(owner);
  }

  @Post('items')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Add a product to the cart',
    description:
      'Product must exist, be active and IN_STOCK. Adds to the existing quantity. ' +
      'A guest without X-Cart-Token gets a new guest cart and its token in `guest_token`.',
  })
  @ApiOkWrapped(CartResponseDto, { status: HttpStatus.CREATED })
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  add(@CurrentCartOwner() owner: CartOwner | null, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(owner, dto);
  }

  @Put('items/:productId')
  @OptionalAuth()
  @ApiOperation({ summary: 'Set the quantity of a product in the cart' })
  @ApiOkWrapped(CartResponseDto)
  @ApiErrors(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  update(
    @CurrentCartOwner() owner: CartOwner | null,
    @Param('productId', ParseIdPipe) productId: bigint,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(owner, productId, dto);
  }

  @Delete('items/:productId')
  @OptionalAuth()
  @ApiOperation({ summary: 'Remove a product from the cart' })
  @ApiOkWrapped(CartResponseDto)
  @ApiErrors(HttpStatus.NOT_FOUND)
  remove(
    @CurrentCartOwner() owner: CartOwner | null,
    @Param('productId', ParseIdPipe) productId: bigint,
  ) {
    return this.cartService.removeItem(owner, productId);
  }

  @Delete()
  @OptionalAuth()
  @ApiOperation({ summary: 'Empty the cart' })
  @ApiOkWrapped(CartResponseDto)
  clear(@CurrentCartOwner() owner: CartOwner | null) {
    return this.cartService.clear(owner);
  }

  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move the guest cart (X-Cart-Token) into my cart after login',
    description:
      'Requires login. Quantities are added (max 99 per product); products that are hidden or out of stock are skipped. ' +
      'The guest cart is deleted. Without a (known) X-Cart-Token this just returns my cart.',
  })
  @ApiOkWrapped(MergeCartResponseDto)
  merge(@CurrentUser() user: AuthUser, @GuestCartOwner() guest: CartOwner | null) {
    return this.cartService.mergeGuestCart(user.id, guest);
  }
}
