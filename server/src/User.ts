import {
  Model, DataTypes, InferAttributes, InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { sequelize } from "./db";

export class User extends Model<
  InferAttributes<User>, InferCreationAttributes<User>
> {
  declare id: CreationOptional<number>;
  declare email: string;
  declare passwordHash: string;
  declare resetTokenHash: string | null;
  declare resetTokenExpiresAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

User.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING(254), allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING(255), allowNull: false },
  resetTokenHash: { type: DataTypes.STRING(64), allowNull: true },
  resetTokenExpiresAt: { type: DataTypes.DATE, allowNull: true },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, {
  sequelize,
  tableName: "users",
  timestamps: true,
});
