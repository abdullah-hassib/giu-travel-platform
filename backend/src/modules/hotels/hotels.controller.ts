import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  Authenticated,
  CurrentUser,
} from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { PageNumberDto } from '../../common/dto/page-number.dto';
import {
  ImageParamsDto,
  ImageUpload,
} from '../media-uploads/image-upload.decorator';
import { UploadedImage } from '../media-uploads/media.service';
import { PublicUser } from '../users/users.service';
import {
  AvailabilityQueryDto,
  CreateHotelDto,
  HotelPoliciesDto,
  HotelSearchDto,
  HotelStatusDto,
  OptionalStayQueryDto,
  ReservationsQueryDto,
  StayQueryDto,
  UpdateHotelDto,
} from './dto/hotel.dto';
import {
  CreateRoomDto,
  NightRangeDto,
  RoomParamsDto,
  UpdateRoomAvailabilityDto,
  UpdateRoomDto,
} from './dto/room.dto';
import { HotelsService } from './hotels.service';
import { RoomsService } from './rooms.service';

@ApiTags('Hotels')
@ApiBadRequestResponse({ description: 'Invalid input' })
@ApiNotFoundResponse({
  description: 'Hotel not found (or deactivated, for public routes)',
})
@Controller('hotels')
export class HotelsController {
  constructor(
    private readonly hotels: HotelsService,
    private readonly rooms: RoomsService,
  ) {}

  @Post()
  @Authenticated('admin')
  @ApiOperation({ summary: 'HTL-01: admin creates a hotel profile' })
  create(@Body() dto: CreateHotelDto) {
    return this.hotels.create(dto);
  }

  @Get('search')
  @ApiOperation({
    summary:
      'HTL-11/HTL-12: search active hotels by city or country, dates and guests',
    description:
      'Lists hotels with at least `rooms` free rooms whose combined occupancy fits `guests`. ' +
      'Price is the cheapest free room per night (USD cents). Ten results per page.',
  })
  search(@Query() query: HotelSearchDto) {
    return this.hotels.search(query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'HTL-02: hotel details; add checkIn/checkOut to include free rooms',
  })
  get(@Param() params: IdParamDto, @Query() query: OptionalStayQueryDto) {
    return this.hotels.getPublic(params.id, query);
  }

  @Patch(':id')
  @Authenticated('admin', 'hotel_moderator')
  @ApiOperation({
    summary: "HTL-01: edit the hotel's profile (assigned moderator or admin)",
  })
  update(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Body() dto: UpdateHotelDto,
  ) {
    return this.hotels.update(user, params.id, dto);
  }

  @Patch(':id/status')
  @Authenticated('admin')
  @ApiOperation({
    summary: 'ACC-15: deactivate or reactivate a hotel',
    description:
      'Deactivated hotels are hidden from search and cannot be booked; existing reservations stay valid.',
  })
  setStatus(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Body() dto: HotelStatusDto,
  ) {
    return this.hotels.setActive(user.id, params.id, dto.active);
  }

  @Put(':id/policies')
  @Authenticated('hotel_moderator')
  @ApiOperation({
    summary:
      'HTL-09/HTL-10: set check-in/check-out times and cancellation tiers',
  })
  setPolicies(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Body() dto: HotelPoliciesDto,
  ) {
    return this.hotels.setPolicies(user, params.id, dto);
  }

  @Post(':id/images')
  @Authenticated('admin', 'hotel_moderator')
  @ImageUpload()
  @ApiOperation({
    summary:
      'HTL-01/GEN-08: add a hotel photo (JPG/PNG, max 5 MB, max 5 photos)',
  })
  addImage(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.hotels.addImage(user, params.id, file);
  }

  @Delete(':id/images/:imageId')
  @Authenticated('admin', 'hotel_moderator')
  @ApiOperation({ summary: 'HTL-01/GEN-08: remove a hotel photo' })
  removeImage(
    @CurrentUser() user: PublicUser,
    @Param() params: ImageParamsDto,
  ) {
    return this.hotels.removeImage(user, params.id, params.imageId);
  }

  @Get(':id/availability')
  @Authenticated('hotel_moderator', 'admin')
  @ApiOperation({
    summary:
      "HTL-08: each room's status per night (Available, Booked with reference, Blocked)",
    description:
      'Nights outside every bookable range are reported as Unavailable. At most 31 nights.',
  })
  availability(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Query() query: AvailabilityQueryDto,
  ) {
    return this.rooms.availabilityView(user, params.id, query);
  }

  @Get(':id/reservations')
  @Authenticated('hotel_moderator', 'admin')
  @ApiOperation({
    summary: "HTL-22: the hotel's reservations (guest, dates, status)",
  })
  reservations(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Query() query: ReservationsQueryDto,
  ) {
    return this.hotels.reservations(user, params.id, query);
  }
}

@ApiTags('Hotel rooms')
@ApiBadRequestResponse({ description: 'Invalid input' })
@ApiNotFoundResponse({ description: 'Hotel or room not found' })
@Controller('hotels/:id/rooms')
export class HotelRoomsController {
  constructor(
    private readonly hotels: HotelsService,
    private readonly rooms: RoomsService,
  ) {}

  @Get('available')
  @ApiOperation({
    summary: 'HTL-15: rooms free for the whole stay, with total stay price',
  })
  available(@Param() params: IdParamDto, @Query() query: StayQueryDto) {
    return this.hotels.availableRooms(params.id, query);
  }

  @Get()
  @Authenticated('hotel_moderator', 'admin')
  @ApiOperation({
    summary: "List the hotel's rooms with their ranges (management view)",
  })
  list(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Query() query: PageNumberDto,
  ) {
    return this.rooms.list(user, params.id, query);
  }

  @Post()
  @Authenticated('hotel_moderator')
  @ApiOperation({
    summary:
      'HTL-03: add a room (name unique in the hotel, occupancy >= 1, price > 0)',
  })
  @ApiConflictResponse({ description: 'Room name already used in this hotel' })
  create(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Body() dto: CreateRoomDto,
  ) {
    return this.rooms.create(user, params.id, dto);
  }

  @Patch(':roomId')
  @Authenticated('hotel_moderator')
  @ApiOperation({
    summary:
      'HTL-05/HTL-06: edit beds, occupancy, price, or deactivate the room',
  })
  @ApiConflictResponse({
    description:
      'Deactivating a room with upcoming reservations, or duplicate name',
  })
  update(
    @CurrentUser() user: PublicUser,
    @Param() params: RoomParamsDto,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.rooms.update(user, params.id, params.roomId, dto);
  }

  @Delete(':roomId')
  @Authenticated('hotel_moderator')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'HTL-06: delete a room that was never reserved' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiConflictResponse({
    description: 'The room has reservations; deactivate it instead',
  })
  remove(@CurrentUser() user: PublicUser, @Param() params: RoomParamsDto) {
    return this.rooms.remove(user, params.id, params.roomId);
  }

  @Post(':roomId/availability')
  @Authenticated('hotel_moderator')
  @ApiOperation({
    summary:
      'HTL-04: add a bookable date range (must not overlap existing ranges)',
  })
  @ApiConflictResponse({ description: 'Overlaps an existing range' })
  addAvailability(
    @CurrentUser() user: PublicUser,
    @Param() params: RoomParamsDto,
    @Body() dto: NightRangeDto,
  ) {
    return this.rooms.addAvailability(user, params.id, params.roomId, dto);
  }

  @Patch(':roomId/availability')
  @Authenticated('hotel_moderator')
  @ApiOperation({
    summary: 'HTL-05/HTL-06: replace bookable ranges and/or blocked ranges',
    description:
      'Rejected if reserved nights would stop being bookable or would be blocked.',
  })
  @ApiConflictResponse({
    description: 'Change overlaps a Confirmed or Pending Payment reservation',
  })
  updateAvailability(
    @CurrentUser() user: PublicUser,
    @Param() params: RoomParamsDto,
    @Body() dto: UpdateRoomAvailabilityDto,
  ) {
    return this.rooms.updateAvailability(user, params.id, params.roomId, dto);
  }
}
